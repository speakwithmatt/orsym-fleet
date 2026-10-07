// Connect or disconnect an installer's GoodWe SEMS account.
// POST {org_id, account, password}: checks the login works, stores it
// encrypted, and runs a first sync. POST {org_id, action: "disconnect"}.
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoodWe, GoodWeError, seal } from "../_shared/goodwe.ts";
import { syncOrg } from "../_shared/goodwe-sync.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { org_id, account, password, action } = await req.json();
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: isAdmin } = await asUser.rpc("is_admin", { o: org_id });
    if (!isAdmin) return json({ error: "Only owners and admins can connect portals" }, 403);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "disconnect") {
      await admin.from("connection_secrets").delete().eq("org_id", org_id).eq("provider", "GoodWe");
      await admin.from("connections").update({ state: "Not connected", last_error: null }).eq("org_id", org_id).eq("provider", "GoodWe");
      return json({ ok: true });
    }

    if (!account || !password) return json({ error: "Enter the SEMS email and password" }, 400);
    const gw = new GoodWe(String(account).trim(), String(password));
    await gw.login();
    await admin.from("connection_secrets").upsert({
      org_id, provider: "GoodWe", secret: { account: String(account).trim(), password: await seal(String(password)) }, updated_at: new Date().toISOString(),
    });
    const result = await syncOrg(admin, org_id, gw);
    return json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof GoodWeError ? err.message : String((err as Error)?.message ?? err);
    return json({ error: msg }, err instanceof GoodWeError && err.kind === "auth" ? 400 : 500);
  }
});
