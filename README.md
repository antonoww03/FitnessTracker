# FitTrack / EGT Track

Single-user training, nutrition, water and weight dashboard. React frontend, FastAPI backend, SQLite persistence.

## Run locally

Requires Python 3.10+ and Node.js 20+.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd frontend
npm ci
cp .env.example .env
npm start
```

Open `http://localhost:3000`. API documentation: `http://localhost:8000/docs`.

For a production build, run `npm run build` in `frontend`. Configure `REACT_APP_BACKEND_URL` before building, or leave it empty and proxy `/api` on the frontend host to FastAPI. A trailing `/api` is accepted. Set `CORS_ORIGINS` to your frontend origin when hosting separately.

## Data and deployment

- `FITTRACK_DB_PATH` defaults to `backend/data/fittrack.sqlite3`. Use an absolute path on a persistent disk/volume for hosting. Back up the database before updates. Use one API deployment with a shared local database file, not independent ephemeral replicas.
- Food, training, water, weight, goals and saved reports survive process restarts. Each date has at most one weight and one saved report.
- This is a **single-user app without login or user isolation**. Keep it local/private or protect the entire frontend and API with an authenticated reverse proxy. CORS is not authentication.
- The previous backend stored entries in Python lists. Already-lost data cannot be recovered from this repository. If a previous process is still running, export its available data before replacing it. No MongoDB migration is performed; the current backend did not use MongoDB.
- USDA credentials are read only from the backend environment and are never printed or sent to the browser. If an earlier deployment logged a real key, rotate that key at the provider.

## Functionality

- Food: manual entry for all six macros, or optional USDA lookup using `USDA_API_KEY`. Lookup accepts English ingredient names with explicit grams/kg, e.g. `200 g chicken breast; 100 g cooked rice`. Results are estimated matches; review the matched food and edit values before confirming. Counts, cups, free-form mixed meals and non-English descriptions are not silently guessed. Missing data/provider errors do not create zero-calorie meals. Lookup itself never saves a meal.
- Training: eight activity types, positive whole-minute durations up to 1440, delete by entry.
- Water: quick/custom entry, daily reset and consecutive-day streak. A streak continues from yesterday if the selected date has no water; future dates never extend it. The bottle uses a 3000 ml visual reference.
- Weight: set/update one measurement per date; read latest or selected date; deletion supported by API.
- Goals: all six targets persist; zero means no progress target. Negative and non-finite values are rejected.
- Daily Review: deterministic summaries of logged data against your own targets. There is no configured generative AI service or personalized medical recommendation engine.
- Reports: **Save Day** creates/overwrites a snapshot, including weight and all macros. Editing daily entries does not update an existing snapshot until Save Day is clicked again. Deleting a report leaves source entries intact. All/week/month/year filters use the selected date (Monday–Sunday weeks); year view shows daily snapshots in that year. CSV/PDF exports include the filtered saved snapshots.
- Date navigation isolates daily records; outdated responses are ignored. Load failures have an explicit Retry state.

## Verification

```bash
python -m pytest tests -q
# Compatibility entry point:
python backend_test.py
cd frontend
CI=true npm run build
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
python -m backend.serve
```

The UI and API are both available at `http://127.0.0.1:8000`. The default bind address is local-only. `HOST` and `PORT` can override it for a hosting service.

A Dockerfile is included for services such as Render:

```bash
docker build -t fittrack .
docker run --rm -p 127.0.0.1:8000:8000 -v fittrack-data:/app/backend/data fittrack
```

Configure a persistent disk at `/app/backend/data` (writable by UID 10001), or point `FITTRACK_DB_PATH` at another persistent writable path. Use `/api` as the health check. `USDA_API_KEY` is optional and belongs in the host's secret/environment settings, never in the image. Do not expose personal data on a public URL without an authentication layer; an unprotected preview must contain disposable demo data only.
