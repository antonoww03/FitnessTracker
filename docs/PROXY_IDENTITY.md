# Auth client identity configuration

The Vercel middleware signs a pseudonymous client identifier for `/api/auth/*`.
The backend verifies the signature before spending a persistent authentication
budget. Per-account limits remain independent of the client identifier.
There is no schema migration or change to session cookies, API rewrites, the
service worker, or browser requests.

## Hosting contract

- Run `frontend/middleware.ts` on Vercel's Node.js runtime. `ipAddress()` uses
  Vercel's platform-owned client header. Do not run this middleware on a server
  where the same header is caller-controlled, or put an unverified proxy in
  front of Vercel.
- `FITTRACK_PROXY_IDENTITY_KEY` is a cryptographically random 32-byte key encoded
  as 64 lowercase hexadecimal characters, identical on the two servers.
  It is a server-only secret: never prefix it with `REACT_APP_`/`VITE_`, include
  it in client bundles, expose it in logs, or commit a deployment value.
- On the backend, `FITTRACK_PROXY_IDENTITY_REQUIRED=1` also prevents accidental
  fallback if the key is removed. A configured but invalid key fails startup.
- Once enabled, password/rate-limited auth operations must go through the
  signing frontend. Unsigned direct-origin requests are rejected. Health checks
  and existing authenticated non-auth API requests do not require a signature.
- With neither setting configured, local development and direct-hosting
  deployments retain their existing transport identity behavior. Unsigned
  identity/forwarding headers are never accepted as authentication identity.

## Staged activation

1. Merge and deploy both code changes with the new settings absent. Run CI and
   normal auth smoke checks first.
2. Set a new secret on the intended Vercel production project and redeploy it.
   Keep preview/staging secrets separate from production; never share the
   production key with untrusted preview branches.
3. Verify the middleware deployment before setting the same backend key and
   `FITTRACK_PROXY_IDENTITY_REQUIRED=1`. Redeploy the backend and verify canonical
   login, registration, recovery and account security operations using only
   disposable test accounts. Confirm unsigned origin auth requests fail and no
   identity/signature headers reach browser responses.
4. Check distinct trusted clients have separate client budgets, while one
   account retains its budget across clients. Do not exhaust real users' budgets.

Signatures expire after 120 seconds (10 seconds future clock tolerance) and bind
the HTTP method and path. A replay uses the same budget, not a new identity.
Keep server clocks synchronized. IP changes legitimately create different client
budgets; users behind one NAT share a budget. Account limits still apply.
Pseudonymous client budgets use existing expiry/cleanup, not user/profile storage.

## Rollback and rotation

For rollback, clear the backend key and required flag together and redeploy the
backend **before** reverting the signing frontend. This explicitly restores the
previous transport policy without a DB rollback; account budgets are retained.
Do not remove only the key while leaving the required flag enabled.

For planned key rotation, use the same staged rollback/activation order in a
controlled window. Rotating the key changes client-budget identities; account
budgets are preserved. Do not mix keys between deployments or represent this
single-key protocol as seamless rotation. For a suspected compromise, prioritize
revoking the old key and accept a bounded auth interruption while both servers
receive the replacement. Keep actual values and operational evidence private.

## Verification

`npm run test:proxy --prefix frontend` exercises the actual middleware and request
header overrides. `python -m pytest tests/test_proxy_identity.py -q` checks the
shared protocol vector, malformed/expired/forged input, client/account budget
isolation, and auth lifecycle. The same backend tests run against disposable
PostgreSQL in CI. Provider routing and real-client separation still require
post-deployment validation; unit tests do not prove platform header behavior.

Platform references: [Vercel request headers](https://vercel.com/docs/headers/request-headers)
and [Routing Middleware API](https://vercel.com/docs/routing-middleware/api).
