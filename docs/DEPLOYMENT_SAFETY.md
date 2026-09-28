# Release and recovery operations

## Deployment order

Run both SQLite and PostgreSQL jobs before merging. These changes add no schema
version: migration 1 and legacy API callers remain supported. Deploy the backend
first, then frontend. New profile clients consume an ETag when the backend exposes
one. History pagination is opt-in so old clients and offline caches still work.
An application now refuses unknown schema versions instead of guessing compatibility.
Future migrations must be additive first; retire old fields only after old clients
and queued offline operations are no longer supported. Test migration from an
existing populated schema and test rollback on failure before changing a version.
Do not mark a newer schema compatible with older code simply to bypass this check.

## Backup and recovery

Personal JSON export is not a full database backup: it excludes sessions, password
hashes, recovery credentials, operation receipts and private push keys. JSON restore
merges by stable ID and is transactional. Existing data not present in the file stays.
Full PostgreSQL backups must include the private `fittrack` schema, including
`app_settings`, `operations`, and `schema_migrations`. Store archives outside the
public repository with access restricted to operators. Use the provider's backup
service or `pg_dump --format=custom --schema=fittrack --no-owner --no-acl` with
connection credentials in the environment, never in shell history or command arguments.
Choose and configure a private archive destination and retention schedule before
relying on these backups. Existing hosting is not reconfigured by this PR.

CI performs a full dump/restore into a separate disposable database and compares
all table fingerprints. For a local repeat, install matching PostgreSQL client
binaries, keep the source idle, create a separate empty `fittrack_test_restore`
database, set FITTRACK_TEST_POSTGRES_URL and FITTRACK_RESTORE_TEST_URL, then run
`python tools/postgres_restore_drill.py`. Both URLs must be local disposable databases.
This validates the procedure; it does not prove an existing production archive is usable.
For disaster recovery, restore a private archive into a new isolated database first,
verify accounts and representative history, disable push workers there, and only
then plan cutover. Recovery can resurrect sessions/accounts from the backup date;
revoke restored sessions and reconcile deletions before making it live.

## Secrets inventory and rotation

- DATABASE_URL belongs only in Render's backend environment. Never expose it as
  VITE_* or REACT_APP_* and never put it in Vercel frontend settings.
- USDA_API_KEY, if used, also belongs only in backend environment.
- VAPID_PRIVATE_KEY or the generated key in private app_settings is a server secret.
  VAPID_PUBLIC_KEY is intentionally public. Rotate these as a matching pair; existing
  browser subscriptions may require renewal. Do not automatically delete the stored
  keys on deployment. With AUTO_VAPID, back up app_settings along with the database.
- Session tokens are opaque per-session credentials, not a shared JWT signing key.
  Use account session revocation after suspected account compromise.

For DB credential rotation, prepare a replacement credential with the required
schema privileges, update the backend secret, redeploy and check API/database
connectivity, then revoke the old credential. If rotating a single provider password
without an overlap window, plan a maintenance window. Do not print credentials to CI
logs. Actual provider rotation requires operator access and is not performed by code.
Use separate projects/credentials for test and production. Verify Supabase's private
fittrack schema remains outside Data API exposure. The app needs migration privileges;
a separate migration identity is a future infrastructure change, not silently enabled here.

## Smoke checks and load measurement

Set repository Actions variable FITNESS_PRODUCTION_ORIGIN to the canonical public
Vercel origin (not a preview URL). `Deployment smoke` checks that configured origin
after successful deployment events or manual dispatch. It never trusts URLs supplied
by the deployment event and uses main's checked-in code. It is read-only: release
metadata, initial assets, API health, anonymous session denial. It does not test
registration or mutate production data. Render deployments not emitting GitHub
deployment events require manual dispatch; Vercel preview events may also check the
configured production origin. The workflow is not proof that both providers finished
publishing the same commit. Review provider status before releasing.

`FITTRACK_E2E_URL=https://YOUR-ORIGIN node frontend/tests/initial-load.cjs` opens a fresh
browser context and prints DNS, TLS, TTFB, paint, auth and login-ready timings. It does
not clear existing user data. An empty browser cache does not imply a sleeping backend.
Measure warm and naturally idle backend separately; no artificial production stress.
Server-Timing reports app processing (not CDN/network overhead). X-Request-ID links
backend failures to existing frontend diagnostics. No form contents or tokens are logged.

## Retention and configuration ownership

Hourly cleanup uses bounded batches for expired sessions, attempts, old push delivery
markers and expired undo records. Authentication also bounds expired-attempt cleanup.
Operation receipts are deliberately retained: deleting them without a coordinated
client retry horizon can duplicate old offline writes. Account deletion removes them.
Monitor growth before introducing any receipt retention policy.

Canonical deployment: frontend/vercel.json for frontend + same-origin API proxy;
render.yaml for PostgreSQL backend; render.sqlite.yaml is an explicit alternative
for paid persistent SQLite hosting, not a second production service. Keep that file
for users of the supported alternative. The obsolete audit branch push trigger is
removed; pull requests and main remain checked. Do not delete a Vercel project until
its domains and traffic prove it unused. External project deletion is not in this PR.
