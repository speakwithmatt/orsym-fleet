# Orsym Fleet

Every solar system an installer has put in, in one place: live status, alerts, service jobs, service plans, stock and warranties.

This is the first live prototype. It's the clickable demo's screens running on real logins and a real database.

## Stack

- **App:** Vite and plain JavaScript (`src/`), deployed as a static site on Cloudflare Pages.
- **Database and logins:** Supabase (project `lsnhlfvyxonphqxgenqu`, in the "orsym" org).
  - Schema is in `supabase/migrations/`.
  - Every table is locked to the installer business (`org_id`) with row level security.
- **Edge functions** (`supabase/functions/`):
  - `invite-member`: sends team invites. It is deployed.
  - `goodwe-connect` and `goodwe-sync`: an installer connects their GoodWe SEMS login (stored encrypted), and every plant on it is pulled into Systems with status and today's kWh. A cron job (`supabase/migrations/20261007000100_goodwe_cron.sql`) syncs every 15 minutes. These use the SEMS+ portal's own web endpoints, which are undocumented and may change.
  - `enphase-connect` and `enphase-sync`: Enphase OAuth and a sync every 15 minutes. These are written but not deployed until Orsym has Enphase developer keys.

## How it works

1. Someone signs in with an email link (Google and Microsoft are wired up but need turning on in Supabase).
2. They create their business, or join one they've been invited to.
3. An empty business can load about 450 sample systems, import a CSV, or add systems by hand.
4. Every change saves to Supabase, and the whole team sees it.

Each business only ever sees its own data.

## Run locally

```sh
cp .env.example .env   # fill in the Supabase URL and publishable key
npm install
npm run dev
```

## Deploy (Cloudflare Pages)

1. In Cloudflare, go to Workers & Pages, then Create, then Pages, then Connect to Git, and pick this repo.
2. Set the build command to `npm run build` and the output directory to `dist`.
3. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, using the values from `.env.example`.
4. In Supabase, go to Authentication, then URL Configuration:
   - Set the Site URL to the Pages URL, for example `https://orsym-fleet.pages.dev`.
   - Add the same URL under Redirect URLs.

## Still to switch on

- **Email:** Supabase's built-in email only sends to members of the Supabase org. Set up custom SMTP so invites reach other people. Google Workspace SMTP for orsym.co.nz works. The setting is under Authentication, then Emails, then SMTP.
- **Google and Microsoft sign-in:** add OAuth client IDs under Authentication, then Providers.
- **Enphase:**
  1. Register an app on the Enphase developer portal (Partner plan).
  2. Set `ENPHASE_CLIENT_ID`, `ENPHASE_CLIENT_SECRET` and `ENPHASE_API_KEY` as edge function secrets.
  3. Deploy `enphase-connect` (with JWT verification off, because Enphase redirects to it) and `enphase-sync`.
  4. Run `supabase/cron.sql`.
- **Not real yet:** emails to customers and contractors, the Fergus and Xero connections, and inverter brands other than GoodWe.
