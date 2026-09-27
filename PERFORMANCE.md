# Request and database lifecycle

Concurrent reads of dashboard, History, Progress, Reports, Profile and training
plan/program data share a transport through `read()`. Completed responses are not
cached by this helper. Each subscriber can abort independently; the final subscriber
aborts the transport. The short cancellation grace allows React effect replacement.
Mutation acknowledgement increments the read generation and coalesces a refresh
event. Responses from earlier generations are rejected as cancelled. Account changes
also advance the generation. Dashboard aborts old batches on date changes/unmount;
views additionally guard state updates. Existing offline cache/queue remains separate.
No mutation is automatically retried by this change.

History applies its date range in SQL, using existing records_date(kind,date).
No duplicate index or schema migration is needed. CI seeds 10,000 out-of-range rows,
asserts the SQLite/PostgreSQL query plan uses that index and measures five API calls
(median under 1 second on the disposable runner). This is a regression ceiling, not
production latency evidence. PostgreSQL queries taking >=250ms emit only duration
and a SQL-template fingerprint; parameters, SQL text and connection URL are omitted.

PostgreSQL has a per-process bounded connection budget (default 4, environment
FITTRACK_DB_MAX_CONNECTIONS), acquisition wait 2s, connect timeout 10s, statement
limit 15s, lock wait 5s, idle transaction limit 30s. Capacity failures produce 503.
Connections are closed on success/error by psycopg context management, and capacity
is released on every exit. This caps connections, not a reusable local pool. Total
budget is per-process times worker/replica count; Supabase's external pooler remains
in use. No deployment configuration changes are required for the existing single
process. Timeouts never trigger automatic write replay.

On database activity, at most hourly per process, cleanup removes up to 500 expired
sessions, attempts expired over one day, push receipts older than 30 days, and expired
Undo trash. No scheduler/paid worker required; a sleeping instance catches up on
activity. Idempotency receipts, recovery credentials and health records are retained.
Large backlogs drain in batches. Multiple workers can safely attempt the same cleanup.

IndexedDB cache entries carry timestamps. Cache writes trigger at most minute-wise
cleanup: 30-day age limit and 250 cached responses, excluding owners with pending
queue operations. Queued writes, account metadata and retry receipts are never
pruned. Owners with pending changes can temporarily exceed the cache budget.

CI enforces gzip JavaScript limits of 240KB per chunk and 380KB total (current build
about 193KB largest and 312KB total). It also runs cancellation/deduplication/stale
response checks, existing browser date-switch and mutation refresh regressions,
SQLite/PostgreSQL tests and Docker smoke tests. Production query plans, traffic-load
sizing and physical phone performance require observation on the deployed service.
