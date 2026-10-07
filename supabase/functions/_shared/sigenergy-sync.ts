// Sigenergy systems → Station, then the shared save.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Sigen } from "./sigenergy.ts";
import { credentials as portalCredentials, first, num, saveStations, type Station, type Status } from "./portal-sync.ts";

// Sigenergy's system status is text; keep it raw and map the obvious words.
export function mapStatus(st: any): { status: Status; raw: string; sev?: "critical" | "warning"; title?: string } {
  const raw = String(first(st, "status", "systemStatus", "runningStatus") ?? "");
  if (/offline|disconnect/i.test(raw)) return { status: "Offline", raw };
  if (/fault|error/i.test(raw)) return { status: "Fault", raw, sev: "critical", title: "Sigenergy reports a fault" };
  if (/alarm|warn/i.test(raw)) return { status: "Fault", raw, sev: "warning", title: "Sigenergy reports an alarm" };
  return { status: "Online", raw };
}

export const credentials = (admin: SupabaseClient, orgId: string) => portalCredentials(admin, orgId, "Sigenergy");

export async function syncOrg(admin: SupabaseClient, orgId: string, sg: Sigen) {
  const stations: Station[] = [];
  for (const st of await sg.systems()) {
    const ext = String(first(st, "systemId", "id") ?? "");
    if (!ext) continue;
    const sum = await sg.summary(ext);
    const s = mapStatus(st);
    stations.push({
      ext, name: String(first(st, "systemName", "name") ?? `Sigenergy ${ext}`),
      address: first(st, "address", "addr", "location"),
      kw: num(first(st, "pvCapacity", "pvCapacityKw", "capacity")),
      todayKwh: num(first(sum, "dailyPowerGeneration", "todayGeneration")),
      status: s.status, raw: s.raw, faultTitle: s.title, faultSev: s.sev,
    });
  }
  return saveStations(admin, orgId, { provider: "Sigenergy", source: "sigenergy", brand: "Sigenergy" }, stations);
}
