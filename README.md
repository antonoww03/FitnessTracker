> Free hosting: see [FREE_HOSTING.md](FREE_HOSTING.md) for Vercel + Render + Supabase.

# FitTrack / EGT Track

Personal training, nutrition, water and weight dashboard with separate user accounts. React frontend, FastAPI backend, SQLite persistence.

## Run locally

Requires Python 3.10+ and Node.js 22.12+.

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
- `/api` is a public database-readiness health check for the hosting platform; it returns no personal data. All personal routes remain authenticated.

## Functionality

- Food: manual entry for all six macros, or optional USDA lookup using `USDA_API_KEY`. Lookup accepts English ingredient names with explicit grams/kg, e.g. `200 g chicken breast; 100 g cooked rice`. Results are estimated matches; review the matched food and edit values before confirming. Counts, cups, free-form mixed meals and non-English descriptions are not silently guessed. Missing data/provider errors do not create zero-calorie meals. Lookup itself never saves a meal.
- Packaged food can be scanned with the device camera or entered as an 8–14
  digit barcode. The backend reads per-100 g data from Open Food Facts; no
  provider key is required. Missing label values remain visibly empty and must
  be checked before saving. Camera access requires HTTPS or local loopback.
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

## Programs, recipes, measurements and offline use

Training supports saved programs with weekday schedules, individual completed sets, a rest timer, previous results and personal records. An unfinished workout is stored on the current device until saved or discarded. History can correct completed reps and load; records are recalculated from saved sessions. Timer vibration is best effort while the app is active, not a background alarm.

Recipes calculate nutrition from ingredient weights and per-100 g values, then log any number of portions. Body measurements track waist, chest, arm and thigh by date. Settings defines separate training/rest nutrition targets; Today selects the day's type and program.

The production build includes a manifest and service worker. Serve it over HTTPS (or local loopback for development). Open it online first, enable offline storage in Settings, and visit the screens to cache their data. Offline food/water/weight/training writes enter a per-account IndexedDB queue. Cached totals reflect the last successful fetch until synchronization. Programs, recipes, measurements, edits and deletes require connectivity. Queue retries use server-side operation IDs to avoid duplicate writes. Review or delete pending entries in Settings; signing out removes cached personal data and the unfinished workout from this device. Device storage is not an encrypted backup.

Settings also supports per-device water, workout and weigh-in reminders. The
permission request is always triggered by an explicit button, a test
notification is available, and duplicate reminder slots are suppressed. With
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` configured, saving
the settings registers an authenticated per-user Web Push subscription. The
server checks due reminders every 30 seconds in the saved IANA timezone and the
service worker displays them after the PWA is closed. Expired subscriptions are
removed and delivery slots are claimed transactionally to avoid duplicates.
Without VAPID configuration the existing in-page reminders continue to work.
On iPhone, background Web Push requires installing the HTTPS PWA on the Home
Screen and allowing notifications. Run only one embedded push worker, or set
`FITTRACK_PUSH_WORKER=0` on web replicas and run a single worker process.

Apple Health is available only through the signed iOS wrapper contract in
`ios/`. Safari and ordinary PWAs cannot call HealthKit directly. The bridge
requests the minimum declared types, restricts messages to the configured
FitTrack host, reads 30-day weight/workout/step/active-energy totals and writes
newly logged FitTrack weight and workouts after explicit authorization. Xcode
signing, HealthKit entitlement, usage descriptions and App Store privacy
declarations are required; see `ios/README.md`.

### Production launch checklist

1. Deploy the included Docker image behind HTTPS and attach persistent writable
   storage at `/app/backend/data`. Configure the host health check as `/api`.
2. Keep authentication enabled, leave `FITTRACK_COOKIE_SECURE=1`, and set
   `CORS_ORIGINS` only when the frontend is hosted on a separate origin.
3. Set optional `USDA_API_KEY`. Generate a VAPID key pair and set the three
   `VAPID_*` secrets to enable closed-app reminders; never expose the private key.
4. Copy the automatic SQLite snapshots to independent private storage and test
   restoring one before accepting real user data.
5. Install the deployed PWA on an iPhone/Android device and verify login,
   camera/gallery, barcode scanning, offline sync, notification delivery and
   safe-area/keyboard layouts.
6. For Apple Health, generate the checked-in Xcode project from `ios/project.yml`,
   set the real HTTPS URL and bundle ID, select an Apple Developer signing team,
   then test on a physical iPhone before App Store submission.

Generate the Web Push key pair once, then copy the two printed values into the
hosting provider's private environment settings and add a contact subject:

```bash
python -m backend.maintenance generate-vapid
# also set VAPID_SUBJECT=mailto:your-address@example.com
```

Keep the same keys across deployments. Replacing them invalidates existing
browser subscriptions and users must save their reminder settings again.

For the prepared one-service deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).
`render.yaml` provisions the HTTPS service, health check and persistent disk,
and enables one-time VAPID key creation on that disk. Only the hosting-account
approval remains; no private key needs to be copied through chat or committed.

Registration displays a recovery code once. Existing accounts can generate one in Settings after entering their password; generating another invalidates the old code. Forgotten-password recovery requires the username and this code, consumes it and revokes existing sessions. There is no email delivery integration. Save the code privately; generate a fresh one after use.

Validation: `python -m pytest tests -q`, `npm run test:features --prefix frontend`, `npm run test:offline --prefix frontend`, and `npm run build --prefix frontend`. DOM/IndexedDB simulations cover interactions and queue isolation. Installed PWA behavior, screen-locked timers and physical-phone layout still need device validation.

## Everyday-use improvements and automated checks

Active workouts allow adding exercises, replacing the name of pending sets, warm-up flags, per-set notes, and superset groups. Assign the same group and set number to paired exercises: the timer waits for the other exercise in that round. Warm-ups stay in History but are excluded from working-set records, volume, and exercise charts. Exercise charts show daily maximum load, maximum reps, and total working volume over 30/90/365 days, alongside the previous recorded day.

Meals now includes recent foods and favorites, category selection, and logging an existing portion on another date. Individual food entries can be copied from Today or History. Settings controls the optional Today sections while keeping the daily plan and nutrition targets prominent. Calendar shows scheduled and completed sessions, lets you edit the selected day's plan, and compares that week's sessions/minutes/volume against the previous week.

The sync indicator shows pending local writes, errors, sync activity, and the timestamp of the last successful summary refresh. Cached totals are explicitly labeled. Account settings can change the password, revoke all sessions, or delete the account after password and username confirmation. Password changes also revoke the recovery code. Live account deletion removes scoped records (including undo history), sessions, recovery codes and retry-operation data. Private server snapshots follow the existing backup retention; copies already exported or cached on another offline device cannot be remotely erased. Password whitespace is now significant; older versions silently trimmed leading/trailing spaces.

`.github/workflows/quality.yml` runs backend tests, DOM feature tests, offline storage tests, PWA shell checks, the production build, and desktop/mobile browser suites on PRs and pushes to main/the audit branch. It uses a disposable local database, read-only repository permissions, no deployment and no application secrets. Mobile screenshots are retained for seven days as CI artifacts.

`npm run test:mobile --prefix frontend` targets a local production server on port 8000 (`FITTRACK_E2E_URL` overrides it only for loopback). It checks 320/390/768 px layouts, a short viewport approximating an open keyboard, manifest availability, service-worker control, offline reload, queued water logging and exactly-once sync. Chromium emulation does not validate physical iPhone/Android installation, OS keyboard behavior or screen-locked vibration. Perform those checks on the deployed HTTPS app before treating phone support as fully verified.

### My Profile

Open **My Profile** to edit first/last name, age, height in cm, weight in kg,
and gender. All fields are optional. Choose a gallery image or use the phone's
camera picker; supported camera behavior depends on the browser/device.
Images up to 10 MB are resized locally to a maximum of 512 px before saving.
The authenticated profile API stores a private per-account profile and validates
image content. Profile data/photos are included in backups and account deletion.
Profile weight is a personal detail; daily measurements remain in the weight log.
Saving profile changes requires connectivity.

Profile browser regression: with a disposable local server running,
`FITTRACK_E2E_URL=http://127.0.0.1:8000 node frontend/tests/profile.cjs`.
