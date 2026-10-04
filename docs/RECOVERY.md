# Backup and recovery runbook

This document describes the supported backup and restore paths for FitTrack. It is intentionally concise and operator-focused.

## Personal JSON backup

The authenticated API exposes a personal JSON export and restore flow. The export contains user fitness/application records only; it is not a full database backup and does not contain server-side authentication/session secrets or private infrastructure credentials.

Restore merges validated records by stable ID inside a transaction. Existing records that are not present in the backup are not deleted. Invalid input must fail without partial writes.

Use the JSON flow for user-level data portability and recovery, not disaster recovery of the hosted PostgreSQL database.

## PostgreSQL backup

A full hosted backup must include the private `fittrack` schema, including application settings, operation receipts and schema migration state.

Preferred order:

1. Use the database provider's managed backup/snapshot capability when available.
2. For an operator-created archive, use a custom-format PostgreSQL dump of the private schema, for example:

```sh
pg_dump --format=custom --schema=fittrack --no-owner --no-acl "$DATABASE_URL" > fittrack.dump
```

Do not place database credentials in the repository, issue comments, CI logs or shell history. Store backup archives outside the public repository with operator-only access and an explicit retention policy.

## Restore procedure

Never restore a production archive directly over the live production database as the first validation step.

1. Create a separate empty PostgreSQL database.
2. Restore the archive into that isolated database with `pg_restore --single-transaction --exit-on-error --no-owner --no-acl`.
3. Verify schema migrations, accounts and representative application/history rows.
4. Compare source/archive expectations with the restored database before any cutover decision.
5. Keep push/background workers disabled against the restored target during validation.
6. If the restored database may contain old sessions, revoke/reconcile sessions and account deletions before making it live.
7. Only after validation, plan an explicit connection cutover and post-cutover smoke test.

The repository includes `tools/postgres_restore_drill.py` and CI coverage that restores a PostgreSQL dump into a separate disposable database and compares table fingerprints. That validates the restore mechanism, but it does not prove that a specific production archive is usable; the production-archive drill is tracked separately.

## Rollback vs restore decision

Application rollback and database restore are different recovery actions.

- For code-only or backward-compatible releases, prefer restoring the previous validated application version while leaving the database unchanged.
- Do not downgrade the production database merely because application code is rolled back.
- If a release contains a destructive or non-backward-compatible migration, database rollback is forbidden by default. Use a forward fix or a verified backup restore path.
- Stop a recovery drill and return to the current validated application version if 5xx errors, authentication failures, schema incompatibility or release/service-worker inconsistency appears.

## Verification ownership

Automated CI must keep the PostgreSQL dump/restore check passing. Production readiness additionally requires a separate end-to-end restore drill using an actual production backup restored into an isolated target, with recovery time and operator decision points recorded. Do not treat CI alone as proof of production backup recoverability.

## Manually approved production archive drill

`Production restore drill` is a `workflow_dispatch` workflow, restricted to `main`.
It does not run on PRs, pushes or a schedule. It uses a disposable PostgreSQL 17
service container on a GitHub-hosted runner. Ordinary PR CI exercises the same
runner with synthetic local data only. Merging the workflow does not run a
production backup or prove production recoverability.

Before the first production run, a repository administrator must:

1. Create the `production-recovery` GitHub Environment. Configure a required
   reviewer and restrict deployment branches to **only main**, with no tag rule.
   A sole maintainer approving their own manual run must leave “prevent self-review”
   off; a second reviewer is preferable when available. Reviewers must check the
   selected commit before approving. Do not enable runner/step debug logging.
2. Add **environment secret** `FITTRACK_BACKUP_SOURCE_URL`. Do not use a repository
   secret, workflow input, issue comment, or checked-in `.env` file. Prefer a dedicated
   read-only backup role with access to all application tables and sequences. If
   an existing owner credential is used for a one-off drill, remove the environment
   secret afterwards. The script forces read-only source transactions, but that is
   not a substitute for a database-enforced least-privilege role.
3. Use a direct or session-pooler connection compatible with concurrent snapshot
   export/import; transaction pooling is not supported. TLS is required. The URL
   accepts only host, port, database, user, password and sslmode options. Percent-encode
   special characters in credentials. Never print the connection URL.
4. Confirm the source is PostgreSQL 17, the application commit matches the deployed
   version, no schema migration is running, and the runner can reach the source.
5. Dispatch from `main` with confirmation `RESTORE-ISOLATED`, then approve the
   environment job. This grants the runner temporary access to production data.

The runner exports a read-only repeatable-read snapshot, fingerprints every
application table and dumps the same snapshot. Normal concurrent application
writes therefore do not invalidate comparison. It holds a source snapshot for up
to several minutes; abort during unexpected production pressure. It uses bounded
connection, lock, statement, subprocess and job timeouts. It releases the source
before restoring or starting application code.

Restore refuses an occupied target or a target other than the explicitly named
local disposable database. It checks all table contents and constraints before
application startup/expired-data cleanup. Application smoke checks run in a fresh
process with only the local URL and with backup/push workers and dotenv loading
disabled. They read a bounded sample of restored accounts using temporary local
sessions, and exercise registration/login/logout plus a new record write/read.
They do not contact a deployed app or send notifications.

Public logs contain pass/fail and duration only, not rows, counts, fingerprints,
credentials or raw database errors. No archive, database log or application output
is uploaded as an artifact or cached. The archive is removed on normal success or
failure; an always-run step removes the database container and its volumes. Forced
runner termination relies on GitHub-hosted VM disposal, so never switch this
workflow to a persistent/self-hosted runner without a separate cleanup design.

Record the approved commit, workflow run, backup/restore/smoke timings and result
in the private operational tracker. A failed run is not recovery evidence. This
is a private-schema logical recovery drill, not proof of provider PITR, role/ACL,
Storage-object or full-cluster recovery. It intentionally excludes ownership and
ACLs; reconcile target permissions and old sessions before any real cutover.
The temporary archive is destroyed: a durable encrypted offsite backup with its
own retention policy is still necessary for disaster recovery.
