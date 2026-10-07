// Connect or disconnect an installer's Sungrow iSolarCloud account.
// POST {org_id, account, password}: finds the region the account is on,
// stores the login encrypted, and runs a first sync. POST {org_id, action: "disconnect"}.
import { createClient } from "npm:@supabase/supabase-js@2";
import { seal } from "../_shared/goodwe.ts";
import { Sungrow, SungrowError } from "../_shared/sungrow.ts";
import { syncOrg } from "../_shared/sungrow-sync.ts";

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
      await admin.from("connection_secrets").delete().eq("org_id", org_id).eq("provider", "Sungrow");
      await admin.from("connections").upsert({ org_id, provider: "Sungrow", kind: "Inverter portal", state: "Not connected", last_error: null }, { onConflict: "org_id,provider" });
      return json({ ok: true });
    }

    if (!account || !password) return json({ error: "Enter the iSolarCloud email and password" }, 400);
    const sg = new Sungrow(String(account).trim(), String(password));
    const server = await sg.loginAnyRegion();
    await admin.from("connection_secrets").upsert({
      org_id, provider: "Sungrow", secret: { account: String(account).trim(), password: await seal(String(password)), server }, updated_at: new Date().toISOString(),
    });
    const result = await syncOrg(admin, org_id, sg);
    return json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof SungrowError ? err.message : String((err as Error)?.message ?? err);
    return json({ error: msg }, err instanceof SungrowError && (err.kind === "auth" || err.kind === "no_account") ? 400 : 500);
  }
});
