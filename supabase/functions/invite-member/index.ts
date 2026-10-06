// Invite someone to an installer business. Checks the caller is an owner or
// admin, records the invite, and sends Supabase's invite email. If the person
// already has an account they just get access the next time they sign in.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { org_id, email: rawEmail, role = "member", redirect_to } = await req.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!org_id || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "org_id and a valid email are required" }, 400);
    if (!["member", "admin"].includes(role)) return json({ error: "bad role" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    // Act as the caller so RLS decides whether they may invite.
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: isAdmin, error: e1 } = await asUser.rpc("is_admin", { o: org_id });
    if (e1 || !isAdmin) return json({ error: "Only owners and admins can invite" }, 403);

    const { error: e2 } = await asUser.from("invites").upsert({ org_id, email, role }, { onConflict: "org_id,email" });
    if (e2) return json({ error: e2.message }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: e3 } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: redirect_to });
    // "already registered" is fine: they'll pick up the invite at next sign-in.
    if (e3 && !/already|registered|exists/i.test(e3.message)) return json({ error: e3.message }, 400);
    return json({ ok: true, emailed: !e3 });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
