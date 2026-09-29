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
