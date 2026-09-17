# Functional audit — 2026-09-17

Baseline: `78e84bd5b5215ba4a069d0eed27bb3366ab52e31`.

Scope: every active application component and API call, current backend routes, historical feature/test descriptions, build/configuration files, dependency installation, validation, persistence and user-visible failure handling. Generic unused UI primitives were checked through compilation rather than individually interaction-tested.

| Area | Confirmed issue in baseline | Change |
| --- | --- | --- |
| Persistence | Python lists/dictionaries lost all entries and reports on restart | SQLite records with transactional writes, unique daily weight/report keys and configurable persistent path |
| Credentials/CORS | USDA key printed at startup; wildcard origins combined with credentials | No key logging; explicit configurable origins and no credentialed wildcard |
| Food lookup | Ignored serving mass; synchronous request inside async handler; timeouts returned successful zero nutrition | Async provider call; explicit ingredient weights; scaled and summed nutrients; clear error status for missing/invalid data, absent configuration and timeout |
| Food entry | Description could change independently of analyzed values; no provider-independent entry | Clear analysis on description edits; review/edit estimated matches; manual entry with all six macros |
| Training | Missing record response; no positive duration/type validation; missing delete treated as success | Return created record; supported types and whole-minute validation; 404 for absent records |
| Water | Isolated component state ignored parent callbacks; streak always 0; reset did not refresh summary | Shared dashboard state; real consecutive-day streak; refresh after add/reset; finite positive custom quantities |
| Weight | UI called routes that did not exist; summary always returned null | Daily upsert, latest/date reads, API deletion, summary/report integration |
| Goals | PUT route missing; summary ignored updates; zero displayed as empty | Persistent goals, consistent summary, explicit zero and invalid-input handling |
| Coach | UI called a missing endpoint and advertised AI | Working logged-data review with custom targets; honest non-AI labeling |
| Reports | No date filters, weight or all-macro display; silent load failure | Saved snapshots retain all fields; all/week/month/year filters; loading/error/retry states |
| Export | Historical tests called a nonexistent route and parsed non-JSON responses as JSON | CSV and PDF exports of saved snapshots; real content checks in isolated tests |
| Date/dashboard | Old responses could overwrite a newly selected day; duplicated water/goals requests; silent errors | Date/request guards; one shared refresh; explicit failure/retry; preserve unsaved form drafts on ordinary refresh |
| Responsive UI | Fixed five-column macro grid and narrow header/water controls could overflow | Responsive macro grid, wrapping header, two-column water buttons and accessible icon labels |
| Frontend installation | react-day-picker 8 incompatible with React 19/date-fns 4; ESLint 9 incompatible with CRA config | Compatible React 18/date-fns 3/ESLint 8 versions and regenerated lockfile; normal npm ci succeeds |
| Page/bootstrap | Global DOM prototype patching, mutation observer and suppressed DataCloneError; hardcoded third-party telemetry | Standard page bootstrap without global patches, suppression or unrelated tracker |
| Tooling | Large unused backend dependency dump; old test runner targeted a hardcoded public deployment | Minimal runtime dependencies, separate test dependencies, env examples, isolated test runner and documented startup |

## Verification completed

- `python -m pytest tests -q`: **42 passed**. Includes CRUD/date isolation, validation, zero goals, upsert, streak gaps/future days, report boundaries/snapshots, CSV/PDF content, missing entries, mocked provider success/failure, process-restart persistence and 20 concurrent water writes.
- `npm ci --ignore-scripts --no-audit --no-fund`: successful without `--legacy-peer-deps` or `--force`.
- `CI=true npm run build`: successful production bundle.
- `npm run test:e2e`: passed against a disposable local API/database and the production frontend build, using headless Chromium. Covers calendar, manual food, training, water/streak refresh, draft preservation, weight, goals including zero, daily review, saved reports, downloads, date navigation, reload, food deletion and retry after a forced API failure.
- Viewports 390, 768 and 1280 px: no horizontal page overflow in the tested dashboard flow; no browser runtime errors.
- `git diff --check` and Python compilation: successful.

## Limits and deliberate behavior

- No real USDA key or running production deployment was supplied. Provider behavior is tested with realistic mock responses; live account credentials, rate limits and match quality still need deployment verification.
- Free-text AI meal parsing and generative coaching are **not implemented** by the current repository. This change does not pretend USDA search or deterministic summaries are an AI model. Manual nutrition entry works without a provider.
- Saved reports remain explicit snapshots, matching the baseline Save Day/Delete Report workflow. Year filters show daily saved rows, not monthly aggregates. Historical reports/tests referenced a different implementation.
- SQLite requires persistent storage in production. Data already lost by the previous in-memory backend cannot be restored by a code patch. No production data was accessed, migrated or modified.
- The app remains single-user with no login/user isolation. Public exposure requires protecting the frontend and API. CORS does not provide authentication.
- CRA/ESLint 8 and some transitive build dependencies are legacy and emit deprecation notices. This is a functional repair, not a complete toolchain migration or security certification.
- No merge or deployment was performed as part of this audit.
