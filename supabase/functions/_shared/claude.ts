// Claude API access for Ask Claude. Each business connects its own Anthropic
// API key; it's stored encrypted in connection_secrets like portal logins.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { unseal } from "./goodwe.ts";

export const MODEL = "claude-sonnet-5-5";
const API = "https://api.anthropic.com/v1";

export class ClaudeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function anthropic(key: string, path: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch(API + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ClaudeError(0, `Couldn't reach Claude: ${e}`);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = r.status === 401 ? "Anthropic didn't accept that API key"
      : r.status === 429 ? "Claude is busy or the account hit its rate limit. Try again shortly."
      : j?.error?.message || `Claude returned ${r.status}`;
    throw new ClaudeError(r.status, msg);
  }
  return j;
}

export async function claudeKey(admin: SupabaseClient, orgId: string) {
  const { data } = await admin.from("connection_secrets").select("secret").eq("org_id", orgId).eq("provider", "Claude").maybeSingle();
  return data ? await unseal((data.secret as { key: string }).key) : null;
}
