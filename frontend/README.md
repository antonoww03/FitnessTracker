# FitTrack frontend

See the [project README](../README.md) for setup, API configuration and behavior.

```bash
npm ci
cp .env.example .env
npm start
```

`npm run build` creates the production bundle. The API URL is set at build time by `REACT_APP_BACKEND_URL`; an empty value uses the same host's `/api` route.

`npm run test:e2e` exercises a running local dashboard and API backed by a disposable database. Install Chromium using `npx playwright install chromium` first.
