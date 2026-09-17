FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
ENV REACT_APP_BACKEND_URL=""
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 FITTRACK_DB_PATH=/app/backend/data/fittrack.sqlite3
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/build ./frontend/build
RUN useradd --uid 10001 --create-home fittrack && mkdir -p /app/backend/data && chown -R fittrack:fittrack /app/backend/data
USER fittrack
EXPOSE 8000
CMD ["python", "-m", "backend.serve"]
