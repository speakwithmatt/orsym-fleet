// Sungrow plants → Station, then the shared save.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Sungrow } from "./sungrow.ts";
import { credentials as portalCredentials, first, num, saveStations, type Station, type Status } from "./portal-sync.ts";

// iSolarCloud sends quantities as {value, unit} or bare numbers. Normalise
// power to kW and energy to kWh.
function qty(v: unknown, base: "W" | "Wh"): number | null {
  if (v && typeof v === "object") {
    const n = num((v as any).value);
    if (n == null) return null;
    const u = String((v as any).unit ?? "").replace(/p$/i, "").trim();
    const scale: Record<string, number> = base === "W"
      ? { W: 0.001, kW: 1, MW: 1000, GW: 1e6 }
      : { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6, "万度": 1e4, "度": 1 };
    return u in scale ? +(n * scale[u]).toFixed(3) : n;
  }
  return num(v);
}

// ps_status: 1 online, 0 offline. ps_fault_status: 1 fault, 2 alarm, 4 normal.
export function mapStatus(st: any): { status: Status; raw: string; sev?: "critical" | "warning"; title?: string } {
  const online = first(st, "ps_status", "online_status");
  const fault = first(st, "ps_fault_status", "fault_status");
  const raw = `ps_status=${online ?? ""} fault=${fault ?? ""}`;
  if (String(online) === "0") return { status: "Offline", raw };
  if (String(fault) === "1") return { status: "Fault", raw, sev: "critical", title: "Sungrow reports a fault" };
  if (String(fault) === "2") return { status: "Fault", raw, sev: "warning", title: "Sungrow reports an alarm" };
  return { status: "Online", raw };
}

export const credentials = (admin: SupabaseClient, orgId: string) => portalCredentials(admin, orgId, "Sungrow");

export async function syncOrg(admin: SupabaseClient, orgId: string, sg: Sungrow) {
  const stations: Station[] = (await sg.plants()).map((st) => {
    const s = mapStatus(st);
    const ext = String(first(st, "ps_id", "psId") ?? "");
    // design_capacity is in W when it's a bare number.
    const cap = first(st, "total_capcity", "total_capacity", "installed_power_map");
    const kw = cap != null ? qty(cap, "W") : (num(st.design_capacity) != null ? +(num(st.design_capacity)! / 1000).toFixed(3) : null);
    return {
      ext, name: String(first(st, "ps_name", "psName") ?? `Sungrow ${ext}`),
      address: first(st, "ps_location", "location", "address"),
      kw, todayKwh: qty(first(st, "today_energy", "today_power", "daily_energy"), "Wh"),
      status: s.status, raw: s.raw, faultTitle: s.title, faultSev: s.sev,
      // A newly built plant: not grid-connected yet and no energy ever recorded.
      pending: String(st.grid_connection_status) === "0" && num((st.total_energy as any)?.value ?? st.total_energy) == null,
    };
  });
  return saveStations(admin, orgId, { provider: "Sungrow", source: "sungrow", brand: "Sungrow" }, stations);
}
