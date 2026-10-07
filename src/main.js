// Boot: sign in, pick or create the installer business, then start the app.
import "./styles.css";
import * as db from "./db.js";
import { esc } from "./util.js";

const gate = document.getElementById("gate");
const shell = document.getElementById("shell");
const LOGO = '<div class="logo"><svg viewBox="8 8 112 102" aria-hidden="true"><use href="#mark"/></svg>Orsym<small>Solar System</small></div>';
const ORG_KEY = "orsym-fleet-org";

function showGate(html) { shell.hidden = true; gate.hidden = false; gate.innerHTML = '<div class="gate-card">' + LOGO + html + "</div>" }

function signInScreen(msg) {
  showGate(
    "<h1>Sign in to Orsym Solar System</h1><p>Use your work email. We'll send you a link, no password needed.</p>" +
    (msg ? '<div class="okmsg">' + esc(msg) + "</div>" : "") +
    '<form id="emailForm"><input class="input" id="email" type="email" required autocomplete="email" placeholder="you@business.co.nz" aria-label="Email"><button class="btn primary" type="submit">Email me a sign-in link</button></form>' +
    '<p class="err" id="err"></p>'
  );
  document.getElementById("emailForm").onsubmit = async e => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    try { await db.signInEmail(email); signInScreen("Check " + email + " for your sign-in link.") }
    catch (err) { document.getElementById("err").textContent = err.message }
  };
  gate.querySelectorAll("[data-oauth]").forEach(b => b.onclick = async () => {
    try { await db.signInOAuth(b.dataset.oauth) } catch (err) { document.getElementById("err").textContent = err.message }
  });
}

function createOrgScreen(user) {
  showGate(
    "<h1>Set up your business</h1><p>Signed in as " + esc(user.email) + ". If your team already uses Orsym Solar System, ask them to invite this email instead.</p>" +
    '<form id="orgForm"><label class="fld"><span>Business name</span><input class="input" id="orgname-in" required maxlength="120" placeholder="Kōwhai Solar &amp; Electrical"></label>' +
    '<label class="fld"><span>Region (optional)</span><input class="input" id="region-in" placeholder="Waikato"></label>' +
    '<button class="btn primary" type="submit">Create</button></form>' +
    '<button class="btn" data-signout="1" type="button">Sign out</button><p class="err" id="err"></p>'
  );
  document.getElementById("orgForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const id = await db.createOrg(document.getElementById("orgname-in").value, document.getElementById("region-in").value);
      localStorageSet(ORG_KEY, id);
      boot();
    } catch (err) { document.getElementById("err").textContent = err.message }
  };
}

function pickOrgScreen(user, orgs) {
  showGate(
    "<h1>Choose a business</h1><p>" + esc(user.email) + " has access to more than one.</p><div class=\"orgpick\">" +
    orgs.map(o => '<button class="btn" data-org="' + o.id + '" type="button"><span>' + esc(o.name) + '</span><span class="muted">' + o.role + "</span></button>").join("") +
    '</div><button class="btn" data-newbiz="1" type="button">+ Set up another business</button>'
  );
  gate.querySelectorAll("[data-org]").forEach(b => b.onclick = () => { localStorageSet(ORG_KEY, b.dataset.org); boot() });
  gate.querySelector("[data-newbiz]").onclick = () => createOrgScreen(user);
}

function localStorageGet(k) { try { return localStorage.getItem(k) } catch { return null } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v) } catch {} }

let started = false;
async function boot() {
  if (!db.configured) {
    showGate("<h1>Not configured</h1><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and rebuild.</p>");
    return;
  }
  const s = await db.session();
  if (!s) return signInScreen();
  const user = s.user;
  await db.acceptInvites().catch(() => 0);
  const orgs = await db.myOrgs();
  if (!orgs.length) return createOrgScreen(user);
  const saved = localStorageGet(ORG_KEY);
  const org = orgs.find(o => o.id === saved) || (orgs.length === 1 ? orgs[0] : null);
  if (!org) return pickOrgScreen(user, orgs);
  if (started) { location.reload(); return }
  started = true;
  gate.hidden = true; shell.hidden = false;
  const { startApp } = await import("./app.js");
  await startApp({ org, user, role: org.role });
}

document.addEventListener("click", async e => {
  if (e.target.closest("[data-signout]")) { await db.signOut(); location.hash = ""; location.reload() }
});

if (db.configured) db.onAuth(sess => { if (sess && !started && gate.querySelector("#emailForm")) boot() });
boot().catch(err => showGate('<h1>Something went wrong</h1><p class="err">' + esc(err.message || String(err)) + '</p><button class="btn" data-signout="1" type="button">Sign out</button>'));
