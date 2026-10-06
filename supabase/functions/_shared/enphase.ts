// Enphase Enlighten v4 helpers shared by enphase-connect and enphase-sync.
// Needs ENPHASE_CLIENT_ID, ENPHASE_CLIENT_SECRET and ENPHASE_API_KEY from
// Orsym's Enphase developer app (Partner plan).
export const ENPHASE = "https://api.enphaseenergy.com";

export function env(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const basic = () => "Basic " + btoa(`${env("ENPHASE_CLIENT_ID")}:${env("ENPHASE_CLIENT_SECRET")}`);

export type Tokens = { access_token: string; refresh_token: string; expires_at: number };

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${ENPHASE}/oauth/token?${new URLSearchParams(params)}`, { method: "POST", headers: { Authorization: basic() } });
  if (!r.ok) throw new Error(`Enphase token ${r.status}: ${await r.text()}`);
  const t = await r.json();
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in - 120) * 1000 };
}
export const exchangeCode = (code: string, redirect_uri: string) =>
  tokenRequest({ grant_type: "authorization_code", redirect_uri, code });
export const refresh = (refresh_token: string) => tokenRequest({ grant_type: "refresh_token", refresh_token });

export async function get(path: string, token: string, params: Record<string, string | number> = {}) {
  const q = new URLSearchParams({ key: env("ENPHASE_API_KEY"), ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const r = await fetch(`${ENPHASE}/api/v4${path}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Enphase ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

// Signed OAuth state so the callback knows which org started the flow.
async function hmac(data: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("SUPABASE_SERVICE_ROLE_KEY")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, "");
}
export async function signState(o: Record<string, string>) {
  const body = btoa(JSON.stringify({ ...o, t: Date.now() }));
  return `${body}.${await hmac(body)}`;
}
export async function readState(state: string) {
  const [body, sig] = state.split(".");
  if (!body || sig !== (await hmac(body))) throw new Error("bad state");
  const o = JSON.parse(atob(body));
  if (Date.now() - o.t > 15 * 60e3) throw new Error("state expired");
  return o as Record<string, string>;
}
