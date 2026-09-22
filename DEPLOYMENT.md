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

## Release acceptance

- Confirm account registration, sign-in and recovery code storage.
- Add one food, water, workout and weight record; restart the service and verify
  the records remain.
- Enable each reminder, send a test notification, close the installed PWA and
  verify one scheduled delivery.
- Test gallery/camera upload and barcode scanning on the actual HTTPS domain.
- Download a JSON backup and copy a server snapshot off the hosting provider.
- For Apple Health, follow `ios/README.md` after the final HTTPS host is known.
