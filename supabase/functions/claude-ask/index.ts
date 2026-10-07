// Ask Claude about the fleet. POST {org_id, messages: [{role, content}]}.
// The fleet is read with the caller's own login, so Claude only ever sees
// what that person can see.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anthropic, claudeKey, ClaudeError, MODEL } from "../_shared/claude.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function all(sb: SupabaseClient, table: string, cols: string, orgId: string, filter?: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    let q = sb.from(table).select(cols).eq("org_id", orgId);
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const v = (x: unknown) => (x == null || x === "" ? "" : String(x).replace(/[|\n]/g, " "));

// The whole fleet as compact pipe-separated tables.
async function snapshot(sb: SupabaseClient, orgId: string, today: string) {
  const [org, systems, alerts, jobs, claims, readings] = await Promise.all([
    sb.from("orgs").select("name, region").eq("id", orgId).single().then((r) => r.data),
    all(sb, "systems", "id, ref, name, town, type, brand, model, kw, status, fault_title, offline_days, perf, exp_kwh, plan, plan_fee, installed, last_service, next_service, inv_warranty, battery, source", orgId),
    all(sb, "alerts", "system_id, sev, title, detail, at", orgId, (q) => q.eq("state", "open")),
    all(sb, "jobs", "system_id, ref, kind, due, who, slot, time, state", orgId, (q) => q.neq("state", "done")),
    all(sb, "claims", "system_id, ref, item, lodged, state", orgId),
    all(sb, "readings", "system_id, kwh", orgId, (q) => q.eq("day", today)),
  ]);
  const ref = new Map(systems.map((s) => [s.id, s.ref]));
  const kwh = new Map(readings.map((r) => [r.system_id, r.kwh]));
  const lines = [
    `Business: ${org?.name ?? "?"}${org?.region ? ` (${org.region})` : ""}`,
    "",
    `SYSTEMS (${systems.length})`,
    "ref|name|town|type|brand|model|kW|status|fault|offline_days|performance_ratio|expected_kWh_per_day|today_kWh|plan|plan_fee_per_yr|installed|last_service|next_service|inverter_warranty_ends|battery|source",
    ...systems.map((s) => [s.ref, s.name, s.town, s.type, s.brand, s.model, s.kw, s.status, s.fault_title, s.offline_days, s.perf, s.exp_kwh, kwh.get(s.id), s.plan, s.plan_fee, s.installed, s.last_service, s.next_service, s.inv_warranty, s.battery, s.source].map(v).join("|")),
    "",
    `OPEN ALERTS (${alerts.length})`,
    "system|severity|title|detail|raised",
    ...alerts.map((a) => [ref.get(a.system_id), a.sev, a.title, a.detail, String(a.at).slice(0, 10)].map(v).join("|")),
    "",
    `OPEN SERVICE JOBS (${jobs.length})`,
    "ref|system|kind|due|assigned_to|booked_day|time|state",
    ...jobs.map((j) => [j.ref, ref.get(j.system_id), j.kind, j.due, j.who, j.slot, j.time, j.state].map(v).join("|")),
    "",
    `WARRANTY CLAIMS (${claims.length})`,
    "ref|system|item|lodged|state",
    ...claims.map((c) => [c.ref, ref.get(c.system_id), c.item, c.lodged, c.state].map(v).join("|")),
  ];
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let org_id = "";
  try {
    const body = await req.json();
    org_id = String(body.org_id ?? "");
    const messages = body.messages;
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: ok } = await asUser.rpc("is_member", { o: org_id });
    if (!ok) return json({ error: "forbidden" }, 403);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = await claudeKey(admin, org_id);
    if (!key) return json({ error: "Claude isn't connected. An owner or admin can connect it under Connections." }, 400);

    const convo = (Array.isArray(messages) ? messages : [])
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20).map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    if (!convo.length || convo[convo.length - 1].role !== "user") return json({ error: "Ask a question first" }, 400);
    while (convo[0].role !== "user") convo.shift();

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
    const data = await snapshot(asUser, org_id, today);
    const system = [
      {
        type: "text",
        text: `You are Claude, built into Orsym Solar System. Solar System is where a solar installer keeps every system they've installed: live status from inverter portals, alerts, service jobs, service plans and warranties. You're helping someone at the business below run their fleet.

Today is ${today} (New Zealand).

How to answer:
- Answer from the fleet data below. If it doesn't hold the answer, say so plainly rather than guessing.
- Refer to systems by their ref, like SYS-1042, along with the customer name, so the person can click through.
- Be brief and practical, in plain New Zealand English. Lead with the answer. Use short lists or a small table when comparing several systems.
- You can draft customer messages, reminders and summaries. You can't send emails, book jobs or change data yourself yet; say where in Solar System to do it (Alerts, Service jobs, Service plans, Systems).
- performance_ratio is actual output against expected (1 = on target). Status "Offline" overnight is normal for many inverters.`,
      },
      { type: "text", text: "FLEET DATA\n\n" + data, cache_control: { type: "ephemeral" } },
    ];

    const r = await anthropic(key, "/messages", { model: MODEL, max_tokens: 2000, system, messages: convo });
    const text = (r.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    return json({ text, usage: r.usage });
  } catch (err) {
    if (err instanceof ClaudeError && err.status === 401) {
      // Key revoked or expired: flag it on Connections.
      try {
        if (org_id) await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
          .from("connections").update({ state: "Reconnect needed", last_error: err.message }).eq("org_id", org_id).eq("provider", "Claude");
      } catch { /* best effort */ }
    }
    return json({ error: String((err as Error)?.message ?? err) }, err instanceof ClaudeError && err.status ? 502 : 500);
  }
});
