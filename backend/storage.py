"""Small DB-API adapter: SQLite locally, private PostgreSQL schema in production."""
from contextlib import contextmanager
import os
import sqlite3
import threading
import psycopg

SCHEMA = (
    'CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind, id))',
    'CREATE INDEX IF NOT EXISTS records_date ON records(kind, date)',
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL)',
    'CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until DOUBLE PRECISION NOT NULL)',
    'CREATE TABLE IF NOT EXISTS operations (owner TEXT NOT NULL, op TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(owner, op))',
    'CREATE TABLE IF NOT EXISTS push_deliveries (subscription_id TEXT NOT NULL, slot TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, PRIMARY KEY(subscription_id, slot))',
    'CREATE TABLE IF NOT EXISTS recovery (user_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
)
INTEGRITY_ERRORS = (sqlite3.IntegrityError, psycopg.IntegrityError)
_initialized = set()
_init_lock = threading.Lock()


def postgres_enabled():
    return bool(os.getenv('DATABASE_URL', '').strip())


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    @staticmethod
    def query(query, parameterized):
        # Only application-owned SQL uses this adapter; user values stay bound.
        query = query.replace('rowid DESC', 'sequence_id DESC')
        query = query.replace("instr(kind, ':')", "strpos(kind, ':')")
        if query.startswith('INSERT OR IGNORE INTO '):
            query = query.replace('INSERT OR IGNORE INTO ', 'INSERT INTO ', 1) + ' ON CONFLICT DO NOTHING'
        if parameterized:
            query = query.replace('%', '%%').replace('?', '%s')
        return query

    def execute(self, query, parameters=None):
        if query == 'BEGIN IMMEDIATE':
            # Serialize idempotent writes across processes before checking their
            # operation IDs. Transaction-scoped locks also work with poolers.
            return self.connection.execute('SELECT pg_advisory_xact_lock(71942001)')
        return self.connection.execute(self.query(query, parameters is not None), parameters)

    def executemany(self, query, parameters):
        cursor = self.connection.cursor()
        cursor.executemany(self.query(query, True), parameters)
        return cursor


@contextmanager
def connect(sqlite_path):
    url = os.getenv('DATABASE_URL', '').strip()
    if not url:
        if os.getenv('FITTRACK_REQUIRE_POSTGRES') == '1':
            raise RuntimeError('DATABASE_URL is required for this deployment')
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(sqlite_path, timeout=15)
        try:
            with connection:
                for statement in SCHEMA:
                    connection.execute(statement)
                yield connection
        finally:
            connection.close()
        return
    # Never silently fall back to disposable SQLite on a remote DB failure.
    options = psycopg.conninfo.conninfo_to_dict(url)
    options.setdefault('sslmode', 'require')
    options['connect_timeout'] = 10
    with psycopg.connect(**options, prepare_threshold=None) as connection:
        if url not in _initialized:
            with _init_lock:
                if url not in _initialized:
                    connection.execute('SELECT pg_advisory_xact_lock(71942000)')
                    connection.execute('CREATE SCHEMA IF NOT EXISTS fittrack')
                    connection.execute('REVOKE ALL ON SCHEMA fittrack FROM PUBLIC')
                    connection.execute('SET LOCAL search_path TO fittrack')
                    for statement in SCHEMA:
                        if statement.startswith('CREATE TABLE IF NOT EXISTS records '):
                            statement = statement.replace('kind TEXT', 'sequence_id BIGSERIAL UNIQUE, kind TEXT', 1)
                        connection.execute(statement)
                    connection.commit()
                    _initialized.add(url)
        connection.execute('SET LOCAL search_path TO fittrack')
        connection.execute("SET LOCAL statement_timeout = '15s'")
        yield PostgresConnection(connection)
