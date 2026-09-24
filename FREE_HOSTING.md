# Free hosting: Vercel + Render + Supabase

This configuration uses the providers' Free/Hobby plans within their quotas.
It does not create subscriptions or promise unlimited free hosting.
No persistent Render disk is needed. SQLite remains the default for local use;
setting `DATABASE_URL` selects PostgreSQL and a failed connection never falls
back to SQLite. `FITTRACK_REQUIRE_POSTGRES=1` also rejects a missing URL.

## 1. Merge the PostgreSQL hosting PR

Merge the reviewed PR into `main` after both GitHub Actions jobs pass.
Do not reuse the old paid Render Blueprint: the default `render.yaml` is now
Free; `render.sqlite.yaml` is the optional paid SQLite version.

## 2. Create the database in Supabase

1. Sign in at https://supabase.com/dashboard and create a project on the **Free**
   plan. Choose a nearby European region and save the database password privately.
2. Wait for provisioning, open **Connect**, and copy the **Session pooler** URI
   (port **5432**, IPv4-compatible), not an API URL or an `anon`/publishable key.
3. Replace the password placeholder with your database password. Reserved URI
   characters in the password must be percent-encoded. Append `?sslmode=require`
   if the URI has no query, or `&sslmode=require` if it already has one.
4. Keep this entire URI secret. It goes only in Render's `DATABASE_URL` field,
   never Vercel, frontend code, GitHub, screenshots or chat.

The backend creates tables automatically in a private `fittrack` schema.
Keep this schema out of Supabase's exposed Data API schemas and do not grant
`anon` or `authenticated` access. The browser uses the existing FitTrack login
and backend; Supabase Auth and Storage setup are not required. Profile photos
are stored with the profile in PostgreSQL and count toward the database quota.

## 3. Create the backend in Render

1. Sign in at https://dashboard.render.com and connect your GitHub account.
2. Create a **Blueprint**, select `antonoww03/FitnessTracker`, branch `main`,
   and the default `render.yaml`.
3. Enter the private Session pooler URI as **DATABASE_URL** when prompted.
4. Verify that the service is **Free** and that no disk or paid database is
   selected before creating it. If the UI asks you to upgrade, stop there.
5. Wait for the service to become Live. Copy its actual HTTPS address, then
   open that address with `/api` appended. It should return `{"status":"ok"}`.

The Blueprint sets secure cookies, requires PostgreSQL, disables local SQLite
snapshots, and stores automatically generated private VAPID keys in PostgreSQL.
Do not share or regenerate these keys on redeploy. No separate key-generation
step is needed.

## 4. Create the frontend in Vercel

Import `antonoww03/FitnessTracker` from **main**:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework | Vite |
| Node.js | 22.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `build` |
| API proxy | `frontend/vercel.json` points to `https://fittrack-api-odyb.onrender.com` |

If using a different Render service, update both API rewrite destinations in
`frontend/vercel.json`, preserving their `/api` paths. `FITTRACK_API_ORIGIN` is
no longer used and can be removed from Vercel. This public service URL contains
no database credentials. Remove `REACT_APP_BACKEND_URL` if present. The checked-in config
proxies API requests on the Vercel origin, preserving secure session cookies.
Deploy and copy the stable production Vercel address.

## 5. Permit your frontend on the backend

In Render → service → Environment, add:

```text
FITTRACK_PUBLIC_ORIGIN=https://YOUR-ACTUAL-PRODUCTION-DOMAIN.vercel.app
```

Use the real stable domain with no trailing slash. Save and redeploy Render.
Before this step, writes through the Vercel URL can return 403. Do not allow
all preview domains. No wildcard CORS setting is needed for the proxy.

Open Vercel, register an account, keep its recovery code, save a food/water
entry and a profile, then verify that they remain after a Render restart.
If the backend has been idle, first open its `/api` URL and wait for it to wake;
then reload Vercel. The frontend allows up to 90 seconds per API request for
cold starts; an unusually slow startup can still time out. Writes are not
automatically retried by the HTTP client.

## Free-plan limitations and backups

- Render sleeps after 15 minutes without inbound traffic. First requests can
  be slow. Background reminders only run while it is awake; delivery at the
  exact scheduled time is **not guaranteed**. A sleeping server can miss a
  reminder. Do not use this setup for critical reminders or keep-alive traffic.
- Supabase Free has a 500 MB database quota and can pause inactive projects.
  Resume a paused project from its dashboard; a quota increase requires review
  of the provider's current plan. Delete unnecessary profile photos/data or
  export records before approaching the limit.
- Download FitTrack's JSON backup regularly and keep it outside the app. It
  restores personal fitness data, not passwords, sessions or all accounts.
- For a full PostgreSQL backup, use `pg_dump` against the private database
  (including the `fittrack` schema) on a trusted machine. SQLite snapshot tools
  intentionally refuse PostgreSQL instead of creating a misleading backup.
- Existing SQLite installations are not automatically imported. For personal
  data, export JSON from the old app, register on the new one, then import it.
  Keep the old SQLite file until you have verified the imported data. Accounts
  and sessions must be recreated; do not discard an existing database.
- Apple Health still requires the native iOS wrapper, Apple signing and a real
  iPhone test. Deploying the web app does not enable HealthKit in Safari.

References checked for this setup:
https://render.com/docs/free
https://supabase.com/docs/guides/database/connecting-to-postgres
https://supabase.com/pricing
