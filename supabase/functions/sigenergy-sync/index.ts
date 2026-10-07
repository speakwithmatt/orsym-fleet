// Refresh Sigenergy data. Called every 15 minutes by pg_cron with the
// x-cron-secret header (all connected orgs), or by a signed-in member with
// {org_id} for "Sync now".
import { createClient } from "npm:@supabase/supabase-js@2";
import { Sigen, SigenError, appLoginWorks } from "../_shared/sigenergy.ts";
import { credentials, syncOrg } from "../_shared/sigenergy-sync.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  let orgIds: string[];
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const { data } = await admin.from("internal_secrets").select("value").eq("name", "cron_secret").single();
    if (!data || data.value !== cron) return json({ error: "forbidden" }, 403);
    // Diagnostic: try a login without saving anything.
    if (body.probe) {
      const sg = new Sigen(String(body.probe.account), String(body.probe.password));
      try { return json({ ok: true, server: await sg.loginAnyRegion() }) }
      catch (e) { return json({ ok: false, kind: (e as SigenError).kind, error: String((e as Error).message), app_login: await appLoginWorks(String(body.probe.account), String(body.probe.password)) }) }
    }
    // Diagnostic: the raw plant list for one org, to check field mapping.
    if (body.inspect) {
      const c = await credentials(admin, String(body.inspect));
      if (!c) return json({ error: "not connected" });
      const sg = new Sigen(c.account, c.password, String((c as Record<string, unknown>).server ?? "aus"));
      const systems = await sg.systems();
      return json({ systems, summary: systems[0] ? await sg.summary(String(systems[0].systemId ?? systems[0].id)) : null });
    }
    const { data: rows } = await admin.from("connection_secrets").select("org_id").eq("provider", "Sigenergy");
    orgIds = (rows ?? []).map((r) => r.org_id);
  } else {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: ok } = await asUser.rpc("is_member", { o: body.org_id });
    if (!ok) return json({ error: "forbidden" }, 403);
    orgIds = [body.org_id];
  }

  const results: Record<string, unknown> = {};
  for (const orgId of orgIds) {
    try {
      const c = await credentials(admin, orgId);
      if (!c) { results[orgId] = "not connected"; continue; }
      results[orgId] = await syncOrg(admin, orgId, new Sigen(c.account, c.password, String((c as Record<string, unknown>).server ?? "aus")));
    } catch (err) {
      const msg = err instanceof SigenError ? err.message : String((err as Error)?.message ?? err);
      results[orgId] = { error: msg };
      await admin.from("connections").update({ last_error: msg.slice(0, 300), state: err instanceof SigenError && err.kind === "auth" ? "Reconnect needed" : "Connected" })
        .eq("org_id", orgId).eq("provider", "Sigenergy");
    }
  }
  return json(cron ? { orgs: orgIds.length, results } : results[orgIds[0]] ?? {});
});
