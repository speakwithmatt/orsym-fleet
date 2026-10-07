// Supabase access: loading an org's fleet into the in-memory shape the screens
// use, and saving changes back.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const sb = configured ? createClient(url, key) : null;

const d = v => (v ? new Date(v + (v.length === 10 ? "T00:00:00" : "")) : null);
const iso = v => (v ? new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : null);
const ok = ({ data, error }) => { if (error) throw error; return data };

/* ---------- auth + orgs ---------- */

export async function session() { return ok(await sb.auth.getSession()).session }
export function onAuth(cb) { return sb.auth.onAuthStateChange((_e, s) => cb(s)) }
export async function signInEmail(email) {
  return ok(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } }));
}
export async function signInOAuth(provider) {
  return ok(await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin, scopes: provider === "azure" ? "email" : undefined } }));
}
export async function signOut() { await sb.auth.signOut() }

export async function acceptInvites() { return ok(await sb.rpc("accept_invites")) }
export async function myOrgs() {
  return ok(await sb.from("members").select("role, orgs(id, name, region, settings)").order("created_at"))
    .map(m => ({ ...m.orgs, role: m.role }));
}
export async function createOrg(name, region) { return ok(await sb.rpc("create_org", { org_name: name, org_region: region || null })) }
export async function saveSettings(org) { ok(await sb.from("orgs").update({ settings: org.settings }).eq("id", org.id)) }

export async function team(orgId) {
  const [members, invites] = await Promise.all([
    sb.from("members").select("user_id, role, email, created_at").eq("org_id", orgId).order("created_at").then(ok),
    sb.from("invites").select("id, email, role, created_at, accepted_at").eq("org_id", orgId).is("accepted_at", null).order("created_at").then(r => (r.error ? [] : r.data)),
  ]);
  return { members, invites };
}
// Invites go through an edge function so the invite email can be sent with
// the service role. If it isn't deployed, the invite row is still created and
// the person joins the next time they sign in with that email.
export async function invite(orgId, email, role) {
  email = email.trim().toLowerCase();
  const fn = await sb.functions.invoke("invite-member", { body: { org_id: orgId, email, role, redirect_to: location.origin } });
  if (!fn.error) return { emailed: !!(fn.data && fn.data.emailed) };
  ok(await sb.from("invites").upsert({ org_id: orgId, email, role }, { onConflict: "org_id,email" }));
  return { emailed: false };
}
export async function cancelInvite(id) { ok(await sb.from("invites").delete().eq("id", id)) }
export async function removeMember(orgId, userId) { ok(await sb.from("members").delete().eq("org_id", orgId).eq("user_id", userId)) }

/* ---------- loading ---------- */

async function all(table, orgId, cols = "*") {
  // PostgREST caps responses at 1000 rows, so page through.
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await sb.from(table).select(cols).eq("org_id", orgId).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function load(org) {
  const [sys, alerts, jobs, people, stock, claims, conns] = await Promise.all(
    ["systems", "alerts", "jobs", "people", "stock", "claims", "connections"].map(t => all(t, org.id))
  );
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const refOf = new Map(sys.map(s => [s.id, s.ref]));
  const systems = sys.map(r => {
    const installed = d(r.installed) || today;
    return {
      uuid: r.id, id: r.ref, name: r.name, contact: r.contact || r.name, type: r.type, brand: r.brand || "Unknown", model: r.model || "",
      kw: Number(r.kw) || 0, panels: r.panels || 0, panelModel: r.panel_model || "", battery: r.battery,
      town: r.town || "", address: r.address || "", phone: r.phone || "", email: r.email || "", serial: r.serial || "",
      installed, ageDays: Math.max(0, Math.round((today - installed) / 864e5)), status: r.status, plan: r.plan, planFee: Number(r.plan_fee) || 0,
      planStart: d(r.plan_start), lastService: d(r.last_service), nextService: d(r.next_service), invWarranty: d(r.inv_warranty) || installed,
      exp: Number(r.exp_kwh) || (Number(r.kw) || 0) * 3.9, perf: r.perf == null ? 1 : Number(r.perf), offlineDays: r.offline_days || 0,
      fault: r.fault_title ? [r.fault_title, r.fault_sev || "warning"] : null, offer: d(r.offer_sent), connected: r.connected,
      source: r.source, externalId: r.external_id,
    };
  });
  return {
    systems,
    alerts: alerts.map(a => ({ id: a.id, sys: refOf.get(a.system_id), sev: a.sev, title: a.title, detail: a.detail || "", at: new Date(a.at), state: a.state }))
      .filter(a => a.sys),
    jobs: jobs.map(j => ({
      uuid: j.id, id: j.ref, sys: refOf.get(j.system_id), kind: j.kind, cat: j.cat, due: d(j.due), who: j.who, slot: d(j.slot), time: j.time,
      via: j.via || [], cust: j.cust, state: j.state, confirmed: j.confirmed,
    })).filter(j => j.sys),
    people: people.map(p => ({ id: p.key, uuid: p.id, name: p.name, short: p.short, kind: p.kind, role: p.role || "", cal: p.cal || "Google Calendar", email: p.email || "" })),
    stock: stock.map(s => ({ uuid: s.id, part: s.part, qty: s.qty, min: s.min })),
    claims: claims.map(c => ({ uuid: c.id, id: c.ref, sys: refOf.get(c.system_id), item: c.item, serial: c.serial, lodged: d(c.lodged), state: c.state })),
    conns: conns.map(c => ({ name: c.provider, kind: c.kind, state: c.state, syncedAt: c.synced_at ? new Date(c.synced_at) : null, error: c.last_error })),
  };
}

/* ---------- saving ---------- */

const sysRow = (orgId, s) => ({
  org_id: orgId, ref: s.id, name: s.name, contact: s.contact, type: s.type, brand: s.brand, model: s.model, kw: s.kw, panels: s.panels,
  panel_model: s.panelModel, battery: s.battery, town: s.town, address: s.address, phone: s.phone, email: s.email, serial: s.serial,
  installed: iso(s.installed), status: s.status, plan: s.plan, plan_fee: s.planFee, plan_start: iso(s.planStart), last_service: iso(s.lastService),
  next_service: iso(s.nextService), inv_warranty: iso(s.invWarranty), exp_kwh: s.exp, perf: s.perf, offline_days: s.offlineDays,
  fault_title: s.fault ? s.fault[0] : null, fault_sev: s.fault ? s.fault[1] : null, offer_sent: iso(s.offer), connected: s.connected !== false,
  source: s.source || "manual",
});

async function chunked(rows, fn, size = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(...(ok(await fn(rows.slice(i, i + size))) || []));
  return out;
}

export async function saveSystems(orgId, list) {
  const saved = await chunked(list.map(s => sysRow(orgId, s)), rows => sb.from("systems").upsert(rows, { onConflict: "org_id,ref" }).select("id, ref"));
  const byRef = new Map(saved.map(r => [r.ref, r.id]));
  list.forEach(s => { if (byRef.has(s.id)) s.uuid = byRef.get(s.id) });
}

export async function saveAlerts(orgId, list, uuidOf) {
  const fresh = list.filter(a => typeof a.id !== "number");
  const existing = list.filter(a => typeof a.id === "number");
  for (const a of existing) ok(await sb.from("alerts").update({ state: a.state, handled_at: a.state === "open" ? null : new Date().toISOString() }).eq("id", a.id));
  if (fresh.length) {
    const rows = await chunked(fresh.map(a => ({ org_id: orgId, system_id: uuidOf(a.sys), sev: a.sev, title: a.title, detail: a.detail, at: a.at.toISOString(), state: a.state })),
      rows => sb.from("alerts").insert(rows).select("id"));
    fresh.forEach((a, i) => { a.id = rows[i].id });
  }
}

export async function saveJobs(orgId, list, uuidOf) {
  const rows = list.map(j => ({
    org_id: orgId, ref: j.id, system_id: uuidOf(j.sys), kind: j.kind, cat: j.cat, due: iso(j.due), who: j.who, slot: iso(j.slot), time: j.time || null,
    via: j.via || [], cust: !!j.cust, state: j.state, confirmed: !!j.confirmed,
  }));
  await chunked(rows, r => sb.from("jobs").upsert(r, { onConflict: "org_id,ref" }).select("id"));
}

export async function savePeople(orgId, list) {
  ok(await sb.from("people").upsert(list.map(p => ({ org_id: orgId, key: p.id, name: p.name, short: p.short || null, kind: p.kind, role: p.role, cal: p.cal, email: p.email })), { onConflict: "org_id,key" }));
}
export async function deletePerson(orgId, key) { ok(await sb.from("people").delete().eq("org_id", orgId).eq("key", key)) }

export async function replaceStockAndClaims(orgId, stock, claims, uuidOf) {
  ok(await sb.from("stock").insert(stock.map(p => ({ org_id: orgId, part: p.part, qty: p.qty, min: p.min }))));
  if (claims.length) ok(await sb.from("claims").insert(claims.map(c => ({ org_id: orgId, ref: c.id, system_id: uuidOf(c.sys), item: c.item, serial: c.serial, lodged: iso(c.lodged), state: c.state }))));
}

// Removes every system loaded from sample data. Alerts, jobs and readings go
// with them through the foreign keys.
export async function clearSample(orgId) {
  ok(await sb.from("systems").delete().eq("org_id", orgId).eq("source", "sample"));
  ok(await sb.from("claims").delete().eq("org_id", orgId).like("ref", "WC-%"));
  ok(await sb.from("stock").delete().eq("org_id", orgId));
  ok(await sb.from("people").delete().eq("org_id", orgId).in("key", ["josh", "reece", "hemi", "sam", "wash", "ridge"]));
}

export async function startEnphase(orgId) {
  const r = await sb.functions.invoke("enphase-connect", { body: { org_id: orgId, redirect_to: location.origin } });
  if (r.error) throw new Error("Enphase connection isn't switched on yet. It needs Orsym's Enphase developer keys first.");
  return r.data; // { url }
}

// Edge function call that surfaces the function's own error message.
async function call(fn, body) {
  const r = await sb.functions.invoke(fn, { body });
  if (r.error) {
    let msg = r.error.message;
    try { const j = await r.error.context.json(); if (j && j.error) msg = j.error } catch {}
    throw new Error(msg);
  }
  return r.data;
}
export const connectGoodWe = (orgId, account, password) => call("goodwe-connect", { org_id: orgId, account, password });
export const disconnectGoodWe = orgId => call("goodwe-connect", { org_id: orgId, action: "disconnect" });
export const syncGoodWe = orgId => call("goodwe-sync", { org_id: orgId });
