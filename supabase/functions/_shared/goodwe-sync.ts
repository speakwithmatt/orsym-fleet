// Turn a GoodWe account's plants into Fleet systems, readings and alerts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoodWe, unseal } from "./goodwe.ts";

const num = (v: unknown) => { const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null };
const first = (o: any, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k]; return null };

// NZ hour, used to ignore "offline" overnight: many GoodWe Wi-Fi dongles
// power down with the inverter when the sun goes.
function nzHour() {
  return Number(new Intl.DateTimeFormat("en-NZ", { hour: "numeric", hour12: false, timeZone: "Pacific/Auckland" }).format(new Date()));
}
function nzToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}

// SEMS has used numbers (-1 offline, 0 waiting, 1 generating, 2 fault) and
// words for status; handle both.
export function mapStatus(raw: unknown): "Online" | "Offline" | "Fault" {
  const s = String(raw ?? "").toLowerCase();
  if (s === "-1" || /offline|disconnect|no.?data|interrupt/.test(s)) return "Offline";
  if (s === "2" || /fault|error|alarm|abnormal/.test(s)) return "Fault";
  return "Online";
}

export async function credentials(admin: SupabaseClient, orgId: string) {
  const { data } = await admin.from("connection_secrets").select("secret").eq("org_id", orgId).eq("provider", "GoodWe").maybeSingle();
  if (!data) return null;
  const s = data.secret as { account: string; password: string };
  return { account: s.account, password: await unseal(s.password) };
}

export async function syncOrg(admin: SupabaseClient, orgId: string, gw: GoodWe) {
  const stations = await gw.stations();
  const { data: existing } = await admin.from("systems").select("id, external_id, status").eq("org_id", orgId).eq("source", "goodwe");
  const byExt = new Map((existing ?? []).map((s) => [s.external_id, s]));
  const { data: refs } = await admin.from("systems").select("ref").eq("org_id", orgId);
  let next = Math.max(1000, ...(refs ?? []).map((r) => Number(String(r.ref).slice(4)) || 0));
  const daylight = (h => h >= 9 && h < 17)(nzHour());
  const today = nzToday();
  let created = 0, problems = 0;

  for (const st of stations) {
    const ext = String(first(st, "id", "stationId", "powerstation_id", "powerStationId") ?? "");
    if (!ext) continue;
    const prev = byExt.get(ext);
    const raw = first(st, "status", "stationStatus", "state");
    let status: string = mapStatus(raw);
    // Overnight "offline" is normal; keep whatever we last knew.
    if (status === "Offline" && !daylight) status = prev?.status ?? "Online";
    const kw = num(first(st, "installedPower", "capacity", "pvCapacity", "installedCapacity"));
    const todayKwh = num(first(st, "productionToday", "eday", "todayEnergy", "dayGeneration"));
    const exp = kw ? +(kw * 3.9).toFixed(2) : null;
    const name = String(first(st, "name", "stationName", "stationname") ?? `GoodWe ${ext}`);
    const address = first(st, "address", "location", "stationAddress");
    const row: Record<string, unknown> = {
      org_id: orgId, source: "goodwe", external_id: ext, name, brand: "GoodWe",
      kw, exp_kwh: exp, status, portal_status: raw == null ? null : String(raw),
      offline_days: status === "Offline" ? 1 : 0, connected: true, last_reading_at: new Date().toISOString(),
      fault_title: status === "Fault" ? `GoodWe reports "${raw}"` : null, fault_sev: status === "Fault" ? "warning" : null,
    };
    if (address) row.address = String(address);
    let id = prev?.id as string | undefined;
    if (prev) {
      const { error } = await admin.from("systems").update(row).eq("id", prev.id);
      if (error) throw error;
    } else {
      row.ref = `SYS-${++next}`;
      row.contact = name;
      const { data, error } = await admin.from("systems").insert(row).select("id").single();
      if (error) throw error;
      id = data.id; created++;
    }
    if (todayKwh != null) await admin.from("readings").upsert({ system_id: id, org_id: orgId, day: today, kwh: todayKwh });
    if (status !== "Online") problems++;
    // A new problem since last sync opens an alert.
    if (status !== "Online" && prev?.status !== status) {
      await admin.from("alerts").insert({
        org_id: orgId, system_id: id, sev: status === "Offline" ? "critical" : "warning",
        title: status === "Offline" ? "Not reporting to GoodWe" : (row.fault_title as string),
        detail: "GoodWe SEMS portal",
      });
    }
  }
  await admin.from("connections").upsert({ org_id: orgId, provider: "GoodWe", kind: "Inverter portal", state: "Connected", synced_at: new Date().toISOString(), last_error: null }, { onConflict: "org_id,provider" });
  return { stations: stations.length, created, problems };
}
