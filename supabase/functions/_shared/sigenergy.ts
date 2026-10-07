// Sigenergy (Sigen Cloud) client. Uses Sigenergy's documented OpenAPI
// (developer.sigencloud.com) with the account's own mySigen email and
// password. Accounts live on one regional server, so login tries each.
// If the OpenAPI refuses a login that the mySigen app accepts, the account
// hasn't been given API access yet: see appLoginWorks().

export const SERVERS: Record<string, string> = {
  aus: "https://openapi-aus.sigencloud.com",
  apac: "https://openapi-apac.sigencloud.com",
  eu: "https://openapi-eu.sigencloud.com",
  us: "https://openapi-us.sigencloud.com",
};
// The mySigen app's own login, used only to tell "wrong password" apart from
// "no API access" when the OpenAPI login fails.
const APP_SERVERS: Record<string, { url: string; client: string }> = {
  aus: { url: "https://api-aus.sigencloud.com", client: "aus" },
  apac: { url: "https://api-apac.sigencloud.com", client: "aus" },
  eu: { url: "https://api-eu.sigencloud.com", client: "eu" },
  us: { url: "https://api-us.sigencloud.com", client: "us" },
};

export class SigenError extends Error {
  constructor(public kind: "auth" | "no_api" | "rate_limit" | "api" | "transport", message: string) { super(message); }
}

// Sigen often sends `data` as a JSON string.
const parse = (v: unknown) => { if (typeof v === "string") { try { return JSON.parse(v) } catch { return v } } return v };

export class Sigen {
  token: string | null = null;
  constructor(private account: string, private password: string, public server = "aus") {}

  private async call(method: string, path: string, body?: unknown) {
    let r: Response;
    try {
      r = await fetch(SERVERS[this.server] + path, {
        method,
        headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new SigenError("transport", `Couldn't reach Sigenergy: ${e}`);
    }
    if (r.status === 424 || r.status === 429) throw new SigenError("rate_limit", "Sigenergy rate limit reached");
    const d = await r.json().catch(() => null);
    if (!d) throw new SigenError("api", `Sigenergy returned ${r.status}`);
    return d;
  }

  async login() {
    const d = await this.call("POST", "/openapi/auth/login/password", { username: this.account, password: this.password });
    const code = Number(d.code);
    const data = parse(d.data) as any;
    if (code === 0 && data?.accessToken) { this.token = String(data.accessToken); return; }
    if (code === 11002 || code === 11003) throw new SigenError("auth", "Sigenergy didn't accept that email and password");
    throw new SigenError("api", `Sigenergy login: ${d.msg || code}`);
  }

  // Log in on whichever region holds the account, starting with this.server.
  async loginAnyRegion() {
    let firstErr: SigenError | null = null;
    for (const s of [this.server, ...Object.keys(SERVERS).filter((k) => k !== this.server)]) {
      this.server = s;
      try { await this.login(); return s; }
      catch (e) { if (!(e instanceof SigenError)) throw e; firstErr ??= e; }
    }
    throw firstErr!;
  }

  async get(path: string): Promise<any> {
    if (!this.token) await this.login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const d = await this.call("GET", path);
      const code = Number(d.code ?? 0);
      if (code === 0) return parse(d.data);
      if ((code === 11002 || code === 11003) && attempt === 0) { await this.login(); continue; }
      if (code === 1110 || code === 1201) throw new SigenError("rate_limit", `Sigenergy ${path}: ${d.msg || code}`);
      throw new SigenError(code === 11002 || code === 11003 ? "auth" : "api", `Sigenergy ${path}: ${d.msg || code}`);
    }
  }

  async systems(): Promise<any[]> {
    const d = await this.get("/openapi/system");
    return (Array.isArray(d) ? d : d?.list ?? d?.records ?? []).map(parse);
  }

  // Today's generation etc. Sigenergy allows this once per 5 minutes per system.
  async summary(systemId: string): Promise<any | null> {
    try { return await this.get(`/openapi/systems/${encodeURIComponent(systemId)}/summary`) }
    catch (e) { if (e instanceof SigenError && (e.kind === "rate_limit" || e.kind === "api")) return null; throw e }
  }
}

// Does the mySigen app accept this login on any region? Only used to explain
// an OpenAPI refusal. The app sends the password AES-CBC encrypted with a
// fixed key and IV.
export async function appLoginWorks(account: string, password: string): Promise<boolean> {
  const kv = new TextEncoder().encode("sigensigensigenp");
  const key = await crypto.subtle.importKey("raw", kv, "AES-CBC", false, ["encrypt"]);
  const enc = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: kv }, key, new TextEncoder().encode(password)))));
  for (const s of Object.values(APP_SERVERS)) {
    try {
      const r = await fetch(`${s.url}/auth/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa("sigen:sigen"),
          lang: "en_US", "client-server": s.client, "AUTH-CLIENT-ID": "sigen", "sg-platform": "web", "sg-pkg": "sigen_app",
        },
        body: new URLSearchParams({ scope: "server", grant_type: "password", userDeviceId: String(Date.now()), username: account, password: enc }),
      });
      const d = await r.json().catch(() => null);
      if (parse(d?.data)?.access_token) return true;
    } catch { /* try the next region */ }
  }
  return false;
}
