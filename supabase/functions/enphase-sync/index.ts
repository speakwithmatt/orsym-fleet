// Pull every connected org's Enphase systems: create/update them as Fleet
// systems, store today's energy, and raise alerts when a system stops
// reporting or reports a problem. Run every 15 minutes by pg_cron (see
// supabase/cron.sql), or POST {org_id} to sync one org now.
import { createClient } from "npm:@supabase/supabase-js@2";
import { env, get, refresh, type Tokens } from "../_shared/enphase.ts";

const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

// Enphase status -> Fleet status. "normal" is fine; "comm" means it hasn't
// reported; the rest are faults of some kind.
function mapStatus(s: string, lastReport: number | null) {
  const hours = lastReport ? (Date.now() / 1000 - lastReport) / 3600 : 999;
  if (s === "comm" || hours > 24) return { status: "Offline", days: Math.max(1, Math.floor(hours / 24)) };
  if (s === "normal") return { status: "Online", days: 0 };
  return { status: "Fault", days: 0 };
}

async function syncOrg(orgId: string, tokens: Tokens) {
  if (Date.now() > tokens.expires_at) {
    tokens = await refresh(tokens.refresh_token);
    await admin.from("connection_secrets").update({ secret: tokens, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("provider", "Enphase");
  }
  const list: any[] = [];
  for (let page = 1; page < 50; page++) {
    const r = await get("/systems", tokens.access_token, { page, size: 100 });
    list.push(...(r.systems ?? []));
    if (!r.systems || r.systems.length < 100) break;
  }

  const { data: existing } = await admin.from("systems").select("id, ref, external_id, status").eq("org_id", orgId).eq("source", "enphase");
  const byExt = new Map((existing ?? []).map((s) => [s.external_id, s]));
  const { data: maxRef } = await admin.from("systems").select("ref").eq("org_id", orgId).order("ref", { ascending: false }).limit(1);
  let next = Math.max(1000, Number(maxRef?.[0]?.ref?.slice(4)) || 1000);
  const today = new Date().toISOString().slice(0, 10);

  for (const e of list) {
    const ext = String(e.system_id);
    const prev = byExt.get(ext);
    const kw = e.system_size ? Number(e.system_size) / 1000 : null;
    const { status, days } = mapStatus(e.status, e.last_report_at ?? null);
    const exp = kw ? kw * 3.9 : null;
    const row: Record<string, unknown> = {
      org_id: orgId, source: "enphase", external_id: ext, name: e.name || e.public_name || `Enphase ${ext}`,
      brand: "Enphase", model: "IQ microinverters", kw, town: e.address?.city ?? null,
      address: [e.address?.city, e.address?.state].filter(Boolean).join(", ") || null,
      installed: e.operational_at ? new Date(e.operational_at * 1000).toISOString().slice(0, 10) : null,
      status, offline_days: days, exp_kwh: exp, perf: exp && e.energy_today != null ? Math.min(1.5, e.energy_today / 1000 / exp) : 1,
      fault_title: status === "Fault" ? `Enphase reports "${e.status}"` : null, fault_sev: status === "Fault" ? "warning" : null,
      connected: true, last_reading_at: e.last_report_at ? new Date(e.last_report_at * 1000).toISOString() : null,
    };
    let id = prev?.id;
    if (prev) {
      await admin.from("systems").update(row).eq("id", prev.id);
    } else {
      row.ref = `SYS-${++next}`;
      if (row.installed) row.inv_warranty = new Date(new Date(row.installed as string).setFullYear(new Date(row.installed as string).getFullYear() + 25)).toISOString().slice(0, 10);
      const { data } = await admin.from("systems").insert(row).select("id").single();
      id = data?.id;
    }
    if (!id) continue;
    if (e.energy_today != null) await admin.from("readings").upsert({ system_id: id, org_id: orgId, day: today, kwh: e.energy_today / 1000 });
    // New problem since last sync -> open an alert.
    if (status !== "Online" && prev?.status !== status) {
      await admin.from("alerts").insert({
        org_id: orgId, system_id: id, sev: status === "Offline" ? "critical" : "warning",
        title: status === "Offline" ? `No data for ${days} day${days === 1 ? "" : "s"}` : (row.fault_title as string),
        detail: "Enphase portal",
      });
    }
  }
  await admin.from("connections").update({ state: "Connected", synced_at: new Date().toISOString(), last_error: null }).eq("org_id", orgId).eq("provider", "Enphase");
  return list.length;
}

Deno.serve(async (req) => {
  // Only the service role (cron, or enphase-connect) may run a sync.
  if (req.headers.get("Authorization") !== `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  let q = admin.from("connection_secrets").select("org_id, secret").eq("provider", "Enphase");
  if (body.org_id) q = q.eq("org_id", body.org_id);
  const { data: orgs } = await q;
  const results: Record<string, unknown> = {};
  for (const o of orgs ?? []) {
    try {
      results[o.org_id] = await syncOrg(o.org_id, o.secret as Tokens);
    } catch (err) {
      results[o.org_id] = String(err);
      await admin.from("connections").update({ last_error: String(err).slice(0, 300) }).eq("org_id", o.org_id).eq("provider", "Enphase");
    }
  }
  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
});
