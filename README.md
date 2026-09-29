# FitTrack

FitTrack is a personal fitness tracker for logging food, water, workouts and body
measurements, reviewing progress, and managing a personal profile.

Features include saved meals and training plans, barcode scanning, data export
and import, optional offline access, and reminders. Camera access and notifications
depend on browser permissions and device support. Apple Health integration requires
the native iOS companion; it is not available directly in a browser.

## Stack

- React and Vite frontend
- Python and FastAPI API
- SQLite for local development; PostgreSQL support for hosted installations
- Installable progressive web app, with an optional iOS companion

## Local development

Use Python 3.12 and Node.js 22.12 or newer in the Node 22 series.
The commands below assume a POSIX shell and run from the repository root.

Start the backend:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
FITTRACK_COOKIE_SECURE=0 uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

The default local database is SQLite; no hosted database account is required.
The cookie override above is for local HTTP development only.

In another terminal, start the frontend:

```sh
npm ci --prefix frontend
npm start --prefix frontend
```

Open <http://localhost:3000>. With `REACT_APP_BACKEND_URL` unset, the development
server forwards API requests to the local backend. Optional settings are documented
with placeholder values in [backend/.env.example](backend/.env.example) and
[frontend/.env.example](frontend/.env.example). Never commit real credentials or
personal data.

## Tests and build

With the Python environment activated:

```sh
python -m pytest tests -q
npm test --prefix frontend
npm run build --prefix frontend
```

The frontend build is written to `frontend/build`. GitHub Actions also runs
PostgreSQL, container and browser checks. Keep the existing checks passing when
submitting a pull request, and include a concise explanation of the change and
how it was verified.

## Hosting

The repository includes Docker, Vercel and Render configuration. Hosted installations
need HTTPS, durable database storage, and a backend reachable through the frontend's
API routes. Configure production credentials outside the repository and never put
server secrets in frontend environment variables. Review the checked-in configuration
for your own domains before deploying. Scheduled reminders require an available backend.

For backup, restore and disaster-recovery procedures, see
[docs/RECOVERY.md](docs/RECOVERY.md).

See [frontend/README.md](frontend/README.md) for frontend commands and
[ios/README.md](ios/README.md) for the native companion setup.
