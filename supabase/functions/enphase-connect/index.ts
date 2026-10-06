// Connect an installer's Enphase account.
// POST (from the app, signed in): returns the Enphase authorise URL.
// GET  (Enphase redirects back here): swaps the code for tokens, stores them,
//      marks the connection Connected and sends the user back to the app.
import { createClient } from "npm:@supabase/supabase-js@2";
import { env, exchangeCode, readState, signState } from "../_shared/enphase.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const callback = () => `${env("SUPABASE_URL")}/functions/v1/enphase-connect`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  if (req.method === "POST") {
    try {
      const { org_id, redirect_to } = await req.json();
      const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const { data: ok } = await asUser.rpc("is_admin", { o: org_id });
      if (!ok) return json({ error: "Only owners and admins can connect portals" }, 403);
      const state = await signState({ org_id, redirect_to });
      const auth = new URL("https://api.enphaseenergy.com/oauth/authorize");
      auth.search = new URLSearchParams({ response_type: "code", client_id: env("ENPHASE_CLIENT_ID"), redirect_uri: callback(), state }).toString();
      return json({ url: auth.toString() });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  // GET callback from Enphase
  let back = "/";
  try {
    const st = await readState(url.searchParams.get("state") ?? "");
    back = st.redirect_to || "/";
    const code = url.searchParams.get("code");
    if (!code) throw new Error(url.searchParams.get("error") ?? "no code");
    const tokens = await exchangeCode(code, callback());
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    await admin.from("connection_secrets").upsert({ org_id: st.org_id, provider: "Enphase", secret: tokens, updated_at: new Date().toISOString() });
    await admin.from("connections").upsert({ org_id: st.org_id, provider: "Enphase", kind: "Inverter portal", state: "Connected", last_error: null }, { onConflict: "org_id,provider" });
    // Kick off a first sync straight away.
    fetch(`${env("SUPABASE_URL")}/functions/v1/enphase-sync`, { method: "POST", headers: { Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ org_id: st.org_id }) }).catch(() => {});
    return Response.redirect(`${back}#connections`, 302);
  } catch (err) {
    return Response.redirect(`${back}#connections?error=${encodeURIComponent(String(err))}`, 302);
  }
});
