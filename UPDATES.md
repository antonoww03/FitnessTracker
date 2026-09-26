# Deployment and offline update contract

Every production build generates a unique version shared by HTML metadata,
application JS, version.json and service-worker.js. The worker precaches every
emitted JS/CSS chunk, including lazy chunks, before install completes. It rejects
an HTML/version mismatch during a deployment. Never manually bump the cache or
edit generated build files. Build/deploy the complete output together.

Vercel and Docker/FastAPI send no-store for HTML, the worker and release metadata.
Content-hashed assets remain cacheable. API responses remain private/no-store;
explicitly opted-in personal IndexedDB caching is independent.

The app checks for a new version on mount, focus, becoming visible, reconnect
and every five minutes while visible/online. Failed checks leave the app usable.
Inequality comparisons also detect rollbacks. A banner prompts the user to update.
Only a click reloads, after checking drafts, in-flight Axios requests, offline
sync/queue and reachable HTML. Queue storage errors fail closed. No update clears
localStorage, IndexedDB, accounts or pending writes.

Worker navigation is network-first with no-store, with fallback to its own
installed offline shell on network/HTTP errors. New online HTML never overwrites
an older installed offline shell. There is deliberately no skipWaiting or
controllerchange reload: other open tabs and their requests must not be disrupted.
Online refresh loads current HTML even while a new worker waits. A worker activates
naturally once the old worker's clients close, then removes only obsolete
fittrack-shell caches. Long-lived tabs can retain older offline shells until all
those tabs close. New release assets are precached independently.

## Rules for future features and integrations

- Register unsaved forms with useDraft. The primary entry form also handles the
  cancellable fittrack-before-update event. Do not force reload on deployment.
- Route requests through the shared Axios instance for refresh guards. Preserve
  operation IDs and per-account isolation in offline writes.
- IndexedDB/API schema changes require explicit backward-compatible migrations,
  versioned payloads and old-client tests. A banner cannot make incompatible data
  formats safe. Never erase local data to implement a migration.
- Keep backend changes compatible with old open clients during separate frontend
  and backend deployments; deploy additive backend changes before consuming them.
- Publish worker, metadata, HTML and assets together; no CDN caching for version.json.
- Versions predating this feature need one online reload to acquire the checker.
  Already-loaded JavaScript cannot be retrofitted by a new deployment.

CI covers release artifact consistency, service-worker API exclusions and offline
shell preservation, update discovery, draft/queue guards, failed deployment and
explicit refresh with saved data, plus existing mobile/offline regression checks.
Real iOS PWA lifecycle and provider propagation still need real-device verification.
