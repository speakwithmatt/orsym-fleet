// Sungrow iSolarCloud client. Sungrow's official OpenAPI needs each installer
// to register a developer app and wait for approval, so this uses the login
// the iSolarCloud web portal itself uses, with the installer's own account.
// It's undocumented and may change. Every request body is AES-encrypted with
// a one-off key, and that key is RSA-encrypted into a header.
// Protocol details follow the MIT-licensed pysolarcloud UserAuth client.
import forge from "npm:node-forge@1";

const APP_KEY = "B0455FBE7AA0328DB57B59AA729F05D8";
const ACCESS_KEY = "9grzgbmxdsp3arfmmgq347xjbza4ysps";
const SYS_CODE = "200"; // web client
const PUBLIC_KEY = forge.pki.publicKeyFromPem(
  "-----BEGIN PUBLIC KEY-----\n" +
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCkecphb6vgsBx4LJknKKes+eyj7+RKQ3fikF5B6\n" +
  "7EObZ3t4moFZyMGuuJPiadYdaxvRqtxyblIlVM7omAasROtKRhtgKwwRxo2a6878qBhTgUVlsqugp\n" +
  "I/7ZC9RmO2Rpmr8WzDeAapGANfHN5bVr7G7GYGwIrjvyxMrAVit/oM4wIDAQAB\n" +
  "-----END PUBLIC KEY-----\n",
);

// NZ accounts usually live on the Australian server; try it first.
export const SERVERS: Record<string, string> = {
  au: "https://augateway.isolarcloud.com",
  intl: "https://gateway.isolarcloud.com.hk",
  eu: "https://gateway.isolarcloud.eu",
};

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALNUM[b % ALNUM.length]).join("");

export function aesEncrypt(text: string, key: string) {
  const c = forge.cipher.createCipher("AES-ECB", key);
  c.start();
  c.update(forge.util.createBuffer(forge.util.encodeUtf8(text)));
  c.finish();
  return forge.util.bytesToHex(c.output.getBytes()).toUpperCase();
}
export function aesDecrypt(hex: string, key: string) {
  const d = forge.cipher.createDecipher("AES-ECB", key);
  d.start();
  d.update(forge.util.createBuffer(forge.util.hexToBytes(hex.trim())));
  if (!d.finish()) throw new Error("bad padding");
  return forge.util.decodeUtf8(d.output.getBytes());
}
const rsa = (s: string) => forge.util.encode64(PUBLIC_KEY.encrypt(forge.util.encodeUtf8(s), "RSAES-PKCS1-V1_5"));

export class SungrowError extends Error {
  constructor(public kind: "auth" | "no_account" | "api" | "transport", message: string) { super(message); }
}

export class Sungrow {
  token: string | null = null;
  userId = "";
  lastLogin: any = null; // raw login reply, for diagnosing failed logins
  constructor(private account: string, private password: string, public server = "au") {}

  private async post(path: string, body: Record<string, unknown>) {
    const key = "web" + rand(13);
    let r: Response;
    try {
      r = await fetch(SERVERS[this.server] + path, {
        method: "POST",
        headers: {
          "content-type": "application/json;charset=UTF-8", sys_code: SYS_CODE, "x-access-key": ACCESS_KEY,
          "x-random-secret-key": rsa(key), "x-limit-obj": rsa(this.userId),
        },
        body: aesEncrypt(JSON.stringify({ appkey: APP_KEY, api_key_param: { timestamp: Date.now(), nonce: rand(32) }, ...body }), key),
      });
    } catch (e) {
      throw new SungrowError("transport", `Couldn't reach Sungrow: ${e}`);
    }
    const text = await r.text();
    if (!r.ok) throw new SungrowError("api", `Sungrow returned ${r.status}`);
    try { return JSON.parse(aesDecrypt(text, key)); } catch { /* fall through */ }
    try { return JSON.parse(text); } catch { throw new SungrowError("api", "Sungrow sent a reply we couldn't read"); }
  }

  async login() {
    const d = await this.post("/v1/userService/login", { user_account: this.account, user_password: this.password });
    this.lastLogin = d;
    const res = d?.result_data ?? {};
    if (res.token && String(res.login_state ?? "1") !== "0") {
      this.token = String(res.token);
      this.userId = String(res.user_id ?? "");
      return;
    }
    // login_state -1: no account with that email on this region's server.
    if (String(res.login_state) === "-1") throw new SungrowError("no_account", "iSolarCloud has no account with that email");
    const msg = res.msg || (d?.result_msg !== "success" && d?.result_msg) || "iSolarCloud didn't accept that email and password";
    // A remaining-attempts count means the account exists here and the password was wrong.
    const remain = res.remain_times;
    if (remain != null && remain !== "") throw new SungrowError("auth", `${msg} (${remain} attempts left before iSolarCloud locks the account)`);
    throw new SungrowError(/not exist|no.?account|unregistered/i.test(msg) ? "no_account" : "auth", msg);
  }

  // Log in on whichever region holds the account, starting with this.server.
  async loginAnyRegion() {
    let firstErr: SungrowError | null = null;
    for (const s of [this.server, ...Object.keys(SERVERS).filter((k) => k !== this.server)]) {
      this.server = s;
      try { await this.login(); return s; }
      catch (e) {
        if (!(e instanceof SungrowError)) throw e;
        firstErr ??= e;
        // Wrong password on an account that exists: stop before burning more attempts.
        if (e.kind === "auth" && /attempts left/.test(e.message)) throw e;
        if (e.kind === "transport") continue;
      }
    }
    throw firstErr!;
  }

  async request(path: string, body: Record<string, unknown> = {}): Promise<any> {
    if (!this.token) await this.login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const d = await this.post(path, { user_id: this.userId, token: this.token, lang: "_en_US", ...body });
      const code = String(d?.result_code ?? "");
      if (code === "1" || d?.result_msg === "success") return d.result_data;
      if (code === "E00003" && attempt === 0) { await this.login(); continue; }
      throw new SungrowError(code === "E00003" ? "auth" : "api", `Sungrow ${path}: ${d?.result_msg || code}`);
    }
  }

  async plants(): Promise<any[]> {
    const out: any[] = [];
    for (let page = 1; page <= 40; page++) {
      const d = await this.request("/v1/powerStationService/getPsList", { valid_flag: "1,3", curPage: page, size: 100 });
      const list = d?.pageList ?? [];
      out.push(...list);
      if (list.length < 100 || out.length >= Number(d?.rowCount ?? 0)) break;
    }
    return out;
  }
}
