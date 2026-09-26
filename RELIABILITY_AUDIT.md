# Reliability and security audit — 2026-09-26

Base: main e706fa5, including merged PR #8. This is a source and regression-test
review, with read-only public deployment probes, not an authenticated inspection
of the Vercel, Render or Supabase dashboards or the production database.

## Frontend, API and deployments

Production probes on fitness-tracker1-seven.vercel.app returned HTML, version.json
and service-worker.js with the correct content types and Cache-Control: no-store.
/api returned 200 JSON with private/no-store; unauthenticated /api/auth/me returned
401. Vercel's same-origin proxy remains intact. API traffic and version metadata
are excluded from service-worker caching; hashed release assets stay cacheable.
PR #8 release tests cover shared build identity, failed/mismatched installs and
preserving an older worker's matching offline shell. No forced activation/reload.

Fixed: the update-fetch timeout now covers body consumption, not only headers.
The update guard also tracks in-progress IndexedDB work, including pending writes
that have not become visible in the queue. Mobile update-banner overflow checks
now run at 320/390/768px. Never clear user storage to install an update.

## Database and concurrency

Added transactional schema_migrations ledger, migration 1 and cleanup/owner
indexes. PostgreSQL startup migrations are serialized by the existing transaction
advisory lock. SQLite uses an immediate transaction and enables foreign keys on
every connection. Existing credential/operation tables are rebuilt transactionally
on SQLite; PostgreSQL adds native constraints. Records have a generated owner_id
from the existing scope prefix, preserving legacy unscoped data and old inserts.
Foreign keys on records, operations, sessions and recovery prevent orphaned data
and cascade on user deletion. Late writes for deleted owners fail instead of
recreating personal records. Public integrity conflicts return sanitized 409s.

Migration 1 checks for legacy orphans first. It aborts without deleting any data;
an operator must back up and repair a reported orphan before retrying. Migration
rollback, preservation, idempotency and stale-owner writes have regressions.
Back up Supabase with pg_dump before the first rollout. SQLite backup jobs are
already disabled for PostgreSQL; a JSON user export is not a full DB backup.

Fixed concurrent recovery-code reuse with DELETE ... RETURNING in the same
transaction as the password change/session revocation. Serialized Delete/Undo and
copy-day read/check/write sequences avoid duplicate undo tokens and race-induced
constraint errors. Existing operation-ID tests cover replay/conflict and rollback.
The global PostgreSQL write advisory lock favors correctness over write throughput;
per-owner lock optimization can be considered when measured load warrants it.

JSON record payloads remain validated by Pydantic, not individual SQL numeric
columns. This PR does not redesign all records into normalized domain tables.

## Security and offline isolation

Reviewed hashed sessions, scrypt password verification, secure/HttpOnly/Strict
cookies, exact origin/header checks, persistent login/recovery limits, deletion,
profile image decoding/dimensions, push endpoint allowlist and account isolation.
Existing tests cover malformed images, ownership, cookie flags, rate limits and
CSRF rejection. No production secrets were accessed or changed.

Fixed cross-tab account confusion: API requests and queued replay send an intended
owner header, verified against the cookie session on the server. A tab retaining
Alice's state cannot read/write or log out Bob after the shared cookie changes.
New normal requests with an account mismatch return to sign-in; sync preserves the
queue on rejection. Legacy clients without the header remain compatible and must
refresh to gain this extra guard. Deploy backend before relying on the new header.

Offline cleanup is now one atomic IndexedDB cursor transaction, only deleting the
requested owner's data and matching cached account. Storage errors propagate
instead of claiming cleanup succeeded. Cached-read results recheck the account
after the async read. Update guards retain drafts, queued writes and active work.

## Mobile and hosting limits

CI covers Chromium at 320/390/768px, profile/camera simulation, offline/reconnect,
release checks and update guards. Physical iPhone/Android camera permissions,
iOS Home Screen worker lifecycle, and push delivery still require device tests.

Free Render can sleep after inactivity. The UI now explains slow initial connection
and that background reminders may be delayed/missed when the server sleeps. The
existing 90-second API timeout stays; writes are not blindly retried. We did not
add keep-alive traffic, change hosting plans or promise uninterrupted delivery.

Manual checks after merge: wait for Render migration/deploy, confirm Vercel deploy,
refresh old clients once, test sign-in/profile/offline replay on a phone, and verify
Supabase backups/retention plus dashboard env vars. Dashboard values, production
schema/data, provider rate limits and actual backup restoration were not accessible
through the connected GitHub tools and are not certified by this audit.

References: https://render.com/docs/free,
https://vercel.com/docs/routing/rewrites,
https://www.postgresql.org/docs/current/explicit-locking.html
