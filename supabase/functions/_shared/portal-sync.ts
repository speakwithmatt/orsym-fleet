// Turn an inverter portal's plants into systems, readings and alerts. Each
// portal client maps its plants to Station first; this does the rest.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { unseal } from "./goodwe.ts";

export type Status = "Online" | "Offline" | "Fault";
export type Station = {
  ext: string;
  name: string;
  address?: string | null;
  kw: number | null;
  todayKwh: number | null;
  status: Status;
  raw: string | null; // the portal's own status, kept for checking the mapping
  faultTitle?: string;
  faultSev?: "critical" | "warning";
};
export type Portal = { provider: string; source: string; brand: string };

export const num = (v: unknown) => { const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null };
export const first = (o: any, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k]; return null };

// NZ hour, used to ignore "offline" overnight: many inverter Wi-Fi dongles
// power down with the inverter when the sun goes.
function nzHour() {
  return Number(new Intl.DateTimeFormat("en-NZ", { hour: "numeric", hour12: false, timeZone: "Pacific/Auckland" }).format(new Date()));
}
export function nzToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}

// A portal login stored by its connect function: {account, password (sealed), ...extra}.
export async function credentials(admin: SupabaseClient, orgId: string, provider: string) {
  const { data } = await admin.from("connection_secrets").select("secret").eq("org_id", orgId).eq("provider", provider).maybeSingle();
  if (!data) return null;
  const s = data.secret as { account: string; password: string; [k: string]: unknown };
  return { ...s, account: s.account, password: await unseal(s.password) };
}

export async function saveStations(admin: SupabaseClient, orgId: string, p: Portal, stations: Station[]) {
  const { data: existing } = await admin.from("systems").select("id, external_id, status").eq("org_id", orgId).eq("source", p.source);
  const byExt = new Map((existing ?? []).map((s) => [s.external_id, s]));
  const { data: refs } = await admin.from("systems").select("ref").eq("org_id", orgId);
  let next = Math.max(1000, ...(refs ?? []).map((r) => Number(String(r.ref).slice(4)) || 0));
  const daylight = (h => h >= 9 && h < 17)(nzHour());
  const today = nzToday();
  let created = 0, problems = 0;

  for (const st of stations) {
    if (!st.ext) continue;
    const prev = byExt.get(st.ext);
    let status: string = st.status;
    // Overnight "offline" is normal; keep whatever we last knew.
    if (status === "Offline" && !daylight) status = prev?.status ?? "Online";
    const faultTitle = st.faultTitle ?? `${p.brand} reports "${st.raw}"`;
    const row: Record<string, unknown> = {
      org_id: orgId, source: p.source, external_id: st.ext, name: st.name, brand: p.brand,
      kw: st.kw, exp_kwh: st.kw ? +(st.kw * 3.9).toFixed(2) : null, status, portal_status: st.raw,
      offline_days: status === "Offline" ? 1 : 0, connected: true, last_reading_at: new Date().toISOString(),
      fault_title: status === "Fault" ? faultTitle : null, fault_sev: status === "Fault" ? (st.faultSev ?? "warning") : null,
    };
    if (st.address) row.address = st.address;
    let id = prev?.id as string | undefined;
    if (prev) {
      const { error } = await admin.from("systems").update(row).eq("id", prev.id);
      if (error) throw error;
    } else {
      row.ref = `SYS-${++next}`;
      row.contact = st.name;
      const { data, error } = await admin.from("systems").insert(row).select("id").single();
      if (error) throw error;
      id = data.id; created++;
    }
    if (st.todayKwh != null) await admin.from("readings").upsert({ system_id: id, org_id: orgId, day: today, kwh: st.todayKwh });
    if (status !== "Online") problems++;
    // A new problem since last sync opens an alert.
    if (status !== "Online" && prev?.status !== status) {
      await admin.from("alerts").insert({
        org_id: orgId, system_id: id, sev: status === "Offline" ? "critical" : (st.faultSev ?? "warning"),
        title: status === "Offline" ? `Not reporting to ${p.provider}` : faultTitle,
        detail: `${p.provider} portal`,
      });
    }
  }
  await admin.from("connections").upsert({ org_id: orgId, provider: p.provider, kind: "Inverter portal", state: "Connected", synced_at: new Date().toISOString(), last_error: null }, { onConflict: "org_id,provider" });
  return { stations: stations.length, created, problems };
}
