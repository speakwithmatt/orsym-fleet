// GoodWe SEMS+ client. GoodWe's official API needs an NDA through their sales
// team, so this uses the same web endpoints the SEMS+ portal itself uses,
// signed in with the installer's own SEMS account (a read-only visitor
// account is best). The endpoints are undocumented and may change.
import { crypto as stdCrypto } from "jsr:@std/crypto@1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { encodeHex } from "jsr:@std/encoding@1/hex";

const LOGIN_URL = "https://semsplus.goodwe.com/web/sems/sems-user/api/v1/auth/cross-login";
const DEFAULT_API = "https://eu-gateway.semsportal.com/web/sems";
const OK = new Set([0, "0", "00000"]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type Token = { uid?: string; token?: string; [k: string]: unknown };

async function sha256Hex(s: string) {
  return encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}
async function signature(t: Token) {
  const ts = Date.now();
  return btoa(`${await sha256Hex(`${ts}@${t.uid ?? ""}@${t.token ?? ""}`)}@${ts}`);
}

export class GoodWeError extends Error {
  constructor(public kind: "auth" | "rate_limit" | "api" | "transport", message: string) { super(message); }
}

export class GoodWe {
  token: Token | null = null;
  api = DEFAULT_API;
  constructor(private account: string, private password: string) {}

  async login() {
    const md5 = encodeHex(new Uint8Array(await stdCrypto.subtle.digest("MD5", new TextEncoder().encode(this.password))));
    let r: Response;
    try {
      r = await fetch(LOGIN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Accept: "application/json, text/plain, */*",
          Origin: "https://semsplus.goodwe.com", Referer: "https://semsplus.goodwe.com/", "User-Agent": UA,
          Token: JSON.stringify({ uid: "", timestamp: 0, token: "", client: "semsPlusWeb", version: "", language: "en" }),
          "X-Signature": await signature({}),
        },
        body: JSON.stringify({ account: this.account, pwd: btoa(md5), agreement: 1, isChinese: false, isLocal: false }),
      });
    } catch (e) {
      throw new GoodWeError("transport", `Couldn't reach GoodWe: ${e}`);
    }
    if (r.status === 429) throw new GoodWeError("rate_limit", "GoodWe rate limit reached");
    const body = await r.json().catch(() => null);
    if (body?.code === "GY0429") throw new GoodWeError("rate_limit", "GoodWe rate limit reached");
    if (!r.ok || !body || !OK.has(body.code) || !body.data?.token) {
      throw new GoodWeError("auth", body?.errorMsg || body?.description || body?.msg || "GoodWe didn't accept that email and password");
    }
    this.token = body.data;
    const api = body.api ?? body.data?.api;
    this.api = typeof api === "string" && api.startsWith("https://") ? api.replace(/\/$/, "") : DEFAULT_API;
  }

  async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    if (!this.token) await this.login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(this.api + path, {
        method: init.method ?? "GET",
        headers: {
          "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA,
          Token: JSON.stringify(this.token), "X-Signature": await signature(this.token!),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (r.status === 429) throw new GoodWeError("rate_limit", "GoodWe rate limit reached");
      if (r.status === 401 && attempt === 0) { await this.login(); continue; }
      if (r.status === 403) throw new GoodWeError("auth", "GoodWe refused access for this account");
      const body = await r.json().catch(() => null);
      if (!body) throw new GoodWeError("api", `GoodWe returned ${r.status}`);
      if (body.code === "GY0429") throw new GoodWeError("rate_limit", "GoodWe rate limit reached");
      if (!OK.has(body.code)) {
        if (body.code === "C0602" && attempt === 0) { await this.login(); continue; }
        throw new GoodWeError("api", `GoodWe ${path}: ${body.errorMsg || body.description || body.msg || body.code}`);
      }
      return body.data;
    }
    throw new GoodWeError("auth", "GoodWe session couldn't be renewed");
  }

  // Every plant the account can see. Installer accounts list through the
  // portal pager; owner accounts may only answer simple-query.
  async stations(): Promise<any[]> {
    const out: any[] = [];
    for (let page = 1; page <= 40; page++) {
      const d = await this.request("/sems-plant/api/portal/stations/page", { method: "POST", body: { current: page, size: 50 } });
      const list = d?.dataList ?? d?.records ?? [];
      out.push(...list);
      if (!list.length || out.length >= Number(d?.total ?? 0)) break;
    }
    if (!out.length) {
      const d = await this.request("/sems-plant/api/stations/simple-query").catch(() => null);
      const list = Array.isArray(d) ? d : d?.dataList ?? d?.list ?? [];
      out.push(...list);
    }
    return out;
  }
}

// Password at rest: AES-GCM with a key derived from the service role key, so
// only edge functions can decrypt it. Stored in connection_secrets, which the
// browser can't read.
async function aesKey() {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("orsym-fleet:" + k));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(text)));
  return `${encodeBase64(iv)}.${encodeBase64(ct)}`;
}
export async function unseal(s: string) {
  const [iv, ct] = s.split(".").map((p) => Uint8Array.from(atob(p), (c) => c.charCodeAt(0)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), ct));
}
