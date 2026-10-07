// Connect or disconnect Claude for a business.
// POST {org_id, key}: checks the Anthropic API key works and stores it
// encrypted. POST {org_id, action: "disconnect"}.
import { createClient } from "npm:@supabase/supabase-js@2";
import { seal } from "../_shared/goodwe.ts";
import { anthropic, ClaudeError } from "../_shared/claude.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { org_id, key, action } = await req.json();
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: isAdmin } = await asUser.rpc("is_admin", { o: org_id });
    if (!isAdmin) return json({ error: "Only owners and admins can connect Claude" }, 403);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "disconnect") {
      await admin.from("connection_secrets").delete().eq("org_id", org_id).eq("provider", "Claude");
      await admin.from("connections").upsert({ org_id, provider: "Claude", kind: "AI assistant", state: "Not connected", last_error: null }, { onConflict: "org_id,provider" });
      return json({ ok: true });
    }

    const k = String(key ?? "").trim();
    if (!k.startsWith("sk-ant-")) return json({ error: "That doesn't look like an Anthropic API key. It starts with sk-ant-" }, 400);
    await anthropic(k, "/models?limit=1");
    await admin.from("connection_secrets").upsert({ org_id, provider: "Claude", secret: { key: await seal(k) }, updated_at: new Date().toISOString() });
    await admin.from("connections").upsert({ org_id, provider: "Claude", kind: "AI assistant", state: "Connected", synced_at: new Date().toISOString(), last_error: null }, { onConflict: "org_id,provider" });
    return json({ ok: true });
  } catch (err) {
    const status = err instanceof ClaudeError && err.status === 401 ? 400 : 500;
    return json({ error: String((err as Error)?.message ?? err) }, status);
  }
});
