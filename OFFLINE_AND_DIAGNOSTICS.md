# Offline mutations and diagnostics

## Offline edit/delete

Enable offline in Settings while online. The default 30-day History range is
prepared along with the daily dashboard. Other History ranges must first be opened
online. Food, water, weight and training records in cached History can be edited
or deleted without a connection. Old caches without a revision need one online
History refresh. This does not enable offline bulk water reset, profile changes,
meal/program deletion, or editing creations that have not reached the server yet.

History marks edits/deletions as pending and disables repeat actions on those rows.
Pending deletion is shown until acknowledged; it is not presented as server success.
Settings lists queued changes, errors and a discard action. A conflict stays queued;
discard it, refresh History online, review the latest record and apply the desired
change again. There is no automatic force-overwrite. Discard is disabled while sync
is active; discarding a lost-response operation cannot undo an already committed
server change. Online deletion keeps the existing Undo toast. Offline deletion can
be discarded before sync; a delayed sync does not promise a future Undo toast.

PUT/DELETE /api/entries/{kind}/{id} support If-Match revisions from History plus
X-Operation-ID. Conditional change and replay response commit in one transaction.
Same operation/payload retries return the original result; different payloads or
stale revisions return 409. Existing callers without revisions remain supported.
The response-loss replay is checked before the version check, including deletes.
Updated entry timestamps prevent edit-away/edit-back ambiguity. Owner headers and
session isolation remain enforced. Confirmed History-cache updates and queue removal
commit together in IndexedDB; pending rows overlay cached/server History responses.
Dashboard aggregates remain the last confirmed snapshot while offline; they refresh
on reconnect. The update guard continues to protect pending writes and storage work.

## Diagnostics

No paid provider or secret is required. Structured server_error/client_error JSON
records go to the backend process logger, available in Render service Logs.
Every backend response has X-Request-ID; unexpected 500 responses also include the
identifier in their JSON. Use it to correlate an API client event with a server
error. Server events contain build commit, application route template, status and
request ID. Exception text/locals, raw URLs and query strings are never added to
these diagnostic records.

Frontend events contain only kind (javascript/unhandled_rejection/render/api),
build version, numeric status and an optional validated request ID. No error text,
stack, form value, health record, username, cookie or token is transmitted by the
collector. The authenticated endpoint rejects extra fields, limits each account to
30 events per 15 minutes, and logs no account identifier. Client-side deduplication
and a 10-event page cap prevent storms. Diagnostics use a separate budget from
login limits and are not queued offline. Delivery is best effort: offline, signed-out
clients, page termination and a sleeping/unavailable backend can lose events.
The React boundary provides an explicit reload action instead of a blank screen;
reloading may lose unsaved UI state and is never automatic.

These are application diagnostic records, not control over hosting access logs or
provider retention policies. No public diagnostic viewer, third-party forwarding,
alerts or full stack-trace collection is enabled. Those require a separate access
and privacy design. Physical-device testing and log retention remain operational
checks for the owner.

## Rollout and verification

Deploy the backend support before relying on new conditional mutations; wait for
both Render and Vercel to be Ready after merge. No new DB schema migration or env
variable is required. Existing operation/attempt tables are reused.

Tests cover stale and concurrent revisions, idempotent edit/delete retry, undo,
owner isolation, offline overlay, queue conflict retention/discard, cache acknowledgement,
diagnostic payload rejection/rate limits/redaction, and a mobile browser offline
edit -> reconnect -> offline delete -> reconnect flow. CI runs SQLite/PostgreSQL,
existing frontend/PWA suites, Docker and the browser tests.
