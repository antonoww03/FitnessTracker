# FitTrack / EGT Track

Personal training, nutrition, water and weight dashboard with separate user accounts. React frontend, FastAPI backend, SQLite persistence.

## Run locally

Requires Python 3.10+ and Node.js 20+.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
FITTRACK_COOKIE_SECURE=0 uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd frontend
npm ci
cp .env.example .env
npm start
```

Open `http://localhost:3000` and create an account. Use the same hostname for UI and API (do not mix localhost and 127.0.0.1). API documentation: `http://localhost:8000/docs`. For Windows, set `FITTRACK_COOKIE_SECURE=0` in `backend/.env` for local HTTP.

For a production build, run `npm run build` in `frontend`. Configure `REACT_APP_BACKEND_URL` before building, or leave it empty and proxy `/api` on the frontend host to FastAPI. A trailing `/api` is accepted. Set `CORS_ORIGINS` to your frontend origin when hosting separately.

## Data and deployment

- `FITTRACK_DB_PATH` defaults to `backend/data/fittrack.sqlite3`. Use an absolute path on a persistent disk/volume for hosting. Back up the database before updates. Use one API deployment with a shared local database file, not independent ephemeral replicas.
- Food, training, water, weight, goals and saved reports survive process restarts. Each date has at most one weight and one saved report.
- Registration/login use scrypt password hashes and opaque, server-side sessions. Cookies are HttpOnly, Secure and SameSite=Strict. Every personal API route checks the session and scopes storage to its owner. Use HTTPS in production; `FITTRACK_COOKIE_SECURE=0` is for local HTTP only.
- Mutation requests require `X-Requested-With: FitTrack` plus an allowed Origin. The frontend sends the header automatically. CORS is not authentication.
- `FITTRACK_AUTH_DISABLED=1` exists only for isolated tests/local development; never enable it on a shared or public deployment. Authentication is on by default.
- The previous backend stored entries in Python lists. Already-lost data cannot be recovered from this repository. If a previous process is still running, export its available data before replacing it. No MongoDB migration is performed; the current backend did not use MongoDB.
- USDA credentials are read only from the backend environment and are never printed or sent to the browser. If an earlier deployment logged a real key, rotate that key at the provider.

## Functionality

- Food: manual entry for all six macros, or optional USDA lookup using `USDA_API_KEY`. Lookup accepts English ingredient names with explicit grams/kg, e.g. `200 g chicken breast; 100 g cooked rice`. Results are estimated matches; review the matched food and edit values before confirming. Counts, cups, free-form mixed meals and non-English descriptions are not silently guessed. Missing data/provider errors do not create zero-calorie meals. Lookup itself never saves a meal.
- Training: eight activity types, duration, exercises with sets/reps/load, and comparison with the most recent session of the same type.
- Water: quick/custom entry, daily reset and consecutive-day streak. A streak continues from yesterday if the selected date has no water; future dates never extend it. The daily target is configurable in Settings.
- Weight: set/update one measurement per date; read latest or selected date; deletion supported by API.
- Goals: all six targets persist; zero means no progress target. Negative and non-finite values are rejected.
- Daily Review: deterministic summaries of logged data against your own targets. There is no configured generative AI service or personalized medical recommendation engine.
- Reports update automatically from current food, water, training and weight records. Save Day optionally retains an otherwise empty date. Filters and CSV/PDF exports use live values; weeks start Monday.
- History covers all four entry types, date range/type filters, editing, deletion and a 15-second Undo action (API restore token lasts 24 hours). Undo refuses to overwrite a newer weight.
- Food can be entered per 100 g or per portion. Grams scale per-100 g nutrition, including USDA matches; changing grams in the editor proportionally scales previously weighed entries.
- Select one food to save a favorite, or several to save a meal. Log the saved meal on any selected day. Copy food and training from another date without changing the source.
- Progress includes 7/30/90-day calories, training, recorded weight and a rolling 7-day mean based only on existing measurements.
- Settings persist a water target, BG/EN interface and light/dark theme per account. Forms warn before navigation discards edits.
- Date navigation isolates daily records; outdated responses are ignored. Load failures have an explicit Retry state.

## Verification

```bash
python -m pytest tests -q
# Compatibility entry point:
python backend_test.py
cd frontend
CI=true npm run build
npm run test:features
```

Browser regression suite (mutates local test data): start the API with a **disposable** `FITTRACK_DB_PATH` and the frontend with its API URL configured, then:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

`FITTRACK_E2E_URL` may override the local frontend URL; non-local hosts are rejected. `CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chromium binary. Never run this suite against a database containing personal records.

See [AUDIT.md](AUDIT.md) for findings, changes and test limitations. Older `test_reports/`, `test_result.md` and `memory/PRD.md` describe historical versions; they do not establish the behavior of the current code.

## Run the complete production app on one address

After building the frontend with an empty `REACT_APP_BACKEND_URL`, run:

```bash
FITTRACK_COOKIE_SECURE=0 python -m backend.serve
```

The UI and API are both available at `http://127.0.0.1:8000`. The default bind address is local-only. `HOST` and `PORT` can override it for a hosting service.

A Dockerfile is included for services such as Render:

```bash
docker build -t fittrack .
docker run --rm -e FITTRACK_COOKIE_SECURE=0 -p 127.0.0.1:8000:8000 -v fittrack-data:/app/backend/data fittrack
```

Configure a persistent disk at `/app/backend/data` (writable by UID 10001), or point `FITTRACK_DB_PATH` at another persistent writable path. Use `/api` as the health check. `USDA_API_KEY` is optional and belongs in the host's secret/environment settings, never in the image. Authentication is enabled by default. Use HTTPS and leave FITTRACK_COOKIE_SECURE at its default 1 for hosting; the example above uses HTTP only on local loopback.

## Backups and upgrading from the single-user version

The server creates a consistent SQLite backup on startup and every 24 hours, keeping the latest seven snapshots in `backend/data/backups`. Set `FITTRACK_BACKUP_DIR` to another private persistent directory; `FITTRACK_AUTO_BACKUP=0` disables this local scheduler. Run one API worker, or schedule backups outside the app for multi-worker deployments. Copy snapshots to separate private storage to protect against disk loss; no off-site service is connected automatically.

Settings also exports a per-user JSON backup (without passwords/sessions) and restores a validated file up to 5 MB. Restore merges by ID and replaces matching entries, in one transaction. Download a fresh backup before restoring an older file.

Existing unowned records are preserved but **never assigned to the first person who registers**. After creating the intended owner's account, an operator can run:

```bash
python -m backend.maintenance backup /private/path/before-migration.sqlite3
python -m backend.maintenance migrate-legacy OWNER_USERNAME
```

Migration refuses a target account that already has data. Full disaster recovery: stop the service, replace `FITTRACK_DB_PATH` with a verified SQLite snapshot, restore private permissions, then restart. Snapshots contain account/session data and must stay private.

There is no email password-reset integration yet. The inline preview uses a disposable demo account and an in-memory adapter; it does not create real accounts or persist data on a server. PDF and backup restore require the live backend. `frontend/preview/index.jsx` is separate from the production entry point.

The feature smoke suite bundles the real React source against the offline demo adapter with pinned esbuild 0.25.10 (downloaded by npx on first use) and runs DOM interactions with JSDOM. It does not substitute for a real-device layout test.
