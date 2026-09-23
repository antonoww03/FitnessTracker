"""Opt-in PostgreSQL regression run against a disposable local database only."""
import os
from urllib.parse import urlparse
import pytest
from backend import storage, server

@pytest.fixture(autouse=True)
def database_backend(monkeypatch):
    url = os.getenv('FITTRACK_TEST_POSTGRES_URL')
    if not url:
        monkeypatch.delenv('DATABASE_URL', raising=False)
        monkeypatch.delenv('FITTRACK_REQUIRE_POSTGRES', raising=False)
        return
    parsed = urlparse(url)
    if parsed.hostname not in ('localhost', '127.0.0.1') or parsed.path != '/fittrack_test':
        raise RuntimeError('Tests require a disposable local fittrack_test database')
    monkeypatch.setenv('DATABASE_URL', url)
    with server.database() as db:
        db.execute('TRUNCATE records, users, sessions, attempts, operations, push_deliveries, recovery, app_settings RESTART IDENTITY')
