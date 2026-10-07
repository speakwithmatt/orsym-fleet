// GoodWe plants → Station, then the shared save.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoodWe } from "./goodwe.ts";
import { credentials as portalCredentials, first, num, saveStations, type Station, type Status } from "./portal-sync.ts";

// SEMS has used numbers (-1 offline, 0 waiting, 1 generating, 2 fault) and
// words for status; handle both.
export function mapStatus(raw: unknown): Status {
  const s = String(raw ?? "").toLowerCase();
  if (s === "-1" || /offline|disconnect|no.?data|interrupt/.test(s)) return "Offline";
  if (s === "2" || /fault|error|alarm|abnormal/.test(s)) return "Fault";
  return "Online";
}

export const credentials = (admin: SupabaseClient, orgId: string) => portalCredentials(admin, orgId, "GoodWe");

export async function syncOrg(admin: SupabaseClient, orgId: string, gw: GoodWe) {
  const stations: Station[] = (await gw.stations()).map((st) => {
    const raw = first(st, "status", "stationStatus", "state");
    const address = first(st, "address", "location", "stationAddress");
    const ext = String(first(st, "id", "stationId", "powerstation_id", "powerStationId") ?? "");
    return {
      ext, name: String(first(st, "name", "stationName", "stationname") ?? `GoodWe ${ext}`),
      address: address ? String(address) : null,
      kw: num(first(st, "installedPower", "capacity", "pvCapacity", "installedCapacity")),
      todayKwh: num(first(st, "productionToday", "eday", "todayEnergy", "dayGeneration")),
      status: mapStatus(raw), raw: raw == null ? null : String(raw),
    };
  });
  return saveStations(admin, orgId, { provider: "GoodWe", source: "goodwe", brand: "GoodWe" }, stations);
}
