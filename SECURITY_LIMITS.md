# Resource protection

All /api request bodies are bounded before JSON parsing: 1,000,000 bytes normally,
5,000,000 for backup restore. Both declared Content-Length and actual received bytes
are checked, including missing/false lengths. Read timeout is 15 seconds; oversized
requests return 413, invalid lengths 400, stalled bodies 408. Restore retains its
existing record validation. Proxy/platform limits may reject a request earlier.
This is an application boundary, not a replacement for edge DDoS protection.

Authenticated heavy operations have atomic PostgreSQL/SQLite per-account budgets
per 60-second fixed window: food analysis 20, barcode lookup 60, export + backup
combined 10, restore 3. Budgets use existing attempts storage and work across workers.
Rejected budgets return 429 with Retry-After: 60. In addition, at most two heavy
handlers run concurrently per process; excess returns 503 / Retry-After: 2. Slots
release on all exits, including validation errors and cancellation. No write retries
are automatic. Default limits require no new environment settings. Per-process
concurrency multiplies with worker/replica count. No IP/proxy trust change is made.

Startup rejects FITTRACK_AUTH_DISABLED=1 when production/Render/Vercel is detected,
PostgreSQL is required or DATABASE_URL exists. Docker explicitly sets
FITTRACK_ENV=production. Local SQLite development can still use the bypass; legacy
route-unit tests explicitly mock the startup guard, while dedicated tests verify it.
The existing real-session PostgreSQL tests remain authenticated.

Owner merges the PR to main; deploy backend image. No schema changes or new services.
If a production deployment currently has FITTRACK_AUTH_DISABLED=1, remove it; the
new image intentionally refuses to start with that unsafe configuration.
