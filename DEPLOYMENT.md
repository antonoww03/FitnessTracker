# Production deployment

The repository includes a production Docker image and a Render Blueprint. The
Blueprint runs one instance in Frankfurt, attaches a 1 GB persistent disk,
checks `/api`, stores SQLite and backups on the disk, and creates a private
VAPID key pair there on first startup. The browser private key is never returned
by the API or committed to Git.

## Render

1. Merge the reviewed pull request into `main`.
2. Open [Render's Blueprint creation page](https://dashboard.render.com/blueprints)
   and connect `antonoww03/FitnessTracker`.
3. Select `render.yaml`, review the paid `0.5c-512mb` web service and 1 GB disk,
   then approve creation. Persistent disks are not available on Render's free
   web plan, so the free plan is suitable only for a disposable preview.
4. Wait for `/api` to pass and open the assigned `onrender.com` HTTPS address.
5. Create the first account, save its recovery code, enable notifications from
   Settings, and install the PWA from the browser.

`USDA_API_KEY` remains optional. Add it as a private environment variable only
if ingredient lookup is required. Do not set `CORS_ORIGINS` for this one-origin
deployment. Do not add extra replicas while SQLite and the embedded reminder
worker are in use.

## Railway alternative

Deploy the repository with its root `Dockerfile`, expose the generated domain,
set the health check to `/api`, and attach one persistent volume at
`/app/backend/data`. Set these variables:

```text
FITTRACK_DB_PATH=/app/backend/data/fittrack.sqlite3
FITTRACK_BACKUP_DIR=/app/backend/data/backups
FITTRACK_COOKIE_SECURE=1
FITTRACK_AUTO_BACKUP=1
FITTRACK_AUTO_VAPID=1
FITTRACK_VAPID_KEY_FILE=/app/backend/data/vapid.json
FITTRACK_VAPID_SUBJECT=https://github.com/antonoww03/FitnessTracker
FITTRACK_PUSH_WORKER=1
FITTRACK_PUBLIC_ORIGIN=https://your-generated-railway-domain
```

Railway documents that non-root Docker users can need `RAILWAY_RUN_UID=0` for a
mounted volume. Add it only if the deployment log reports permission denied for
`/app/backend/data`; Render does not require this override.

## Vercel frontend with a persistent backend

This is a split deployment, not a migration of SQLite to Vercel. The backend
and scheduled notifications still require the Render/Railway service above
with its persistent disk. Creating that service can incur hosting charges.

1. Deploy the backend using one of the options above and verify its `/api` URL.
2. Import the branch containing these changes (`fix/full-functional-audit`
   until merged). In Vercel select **Root Directory: frontend**, **Framework
   Preset: Vite**, Node **22.x**, output **build**. Do not use the repository-root
   Services preset shown for the old Create React App version.
3. Set `FITTRACK_API_ORIGIN` in Vercel to the actual backend HTTPS origin, e.g.
   `https://your-service.onrender.com` (no `/api`). Remove
   `REACT_APP_BACKEND_URL` if previously configured. `frontend/vercel.mjs`
   proxies `/api` to the backend and handles browser route refreshes.
4. Set `FITTRACK_PUBLIC_ORIGIN` on the backend to your stable Vercel HTTPS
   domain, without a trailing slash. Keep `FITTRACK_COOKIE_SECURE=1` and
   restart the backend. This permits authenticated writes from that domain.
5. Verify sign-up, sign-in, profile saving and logout through the Vercel URL.
   Check that `/api/auth/me` returns JSON rather than the frontend HTML, then
   test a notification. Repeat the release acceptance checks below.

The browser uses one origin so HttpOnly session cookies remain usable without
third-party cookies. Do not enable caching for API responses. Only explicitly
trusted additional frontend origins should be added to `CORS_ORIGINS` on the
backend; do not allow all Vercel preview domains. Prefer a separate backend
and database when testing preview deployments.

Configuration reference: https://vercel.com/docs/project-configuration/vercel-ts
and https://vercel.com/docs/routing/rewrites.

## Release acceptance

- Confirm account registration, sign-in and recovery code storage.
- Add one food, water, workout and weight record; restart the service and verify
  the records remain.
- Enable each reminder, send a test notification, close the installed PWA and
  verify one scheduled delivery.
- Test gallery/camera upload and barcode scanning on the actual HTTPS domain.
- Download a JSON backup and copy a server snapshot off the hosting provider.
- For Apple Health, follow `ios/README.md` after the final HTTPS host is known.
