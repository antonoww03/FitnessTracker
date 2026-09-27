"""Small DB-API adapter: SQLite locally, private PostgreSQL schema in production."""
from contextlib import contextmanager
import os
import sqlite3
import threading
import time
import hashlib
import logging
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
# Per process cap, including callers waiting for PostgreSQL connection startup.
_pg_slots = threading.BoundedSemaphore(int(os.getenv('FITTRACK_DB_MAX_CONNECTIONS', '4')))
_cleanup_lock = threading.Lock()
_last_cleanup = {}


class DatabaseBusy(Exception):
    pass


@contextmanager
def postgres_slot():
    if not _pg_slots.acquire(timeout=2):
        raise DatabaseBusy('Database capacity temporarily exhausted')
    try:
        yield
    finally:
        _pg_slots.release()


def cleanup(connection, key, postgres=False):
    now = time.time()
    if now - _last_cleanup.get(key, 0) < 3600 or not _cleanup_lock.acquire(blocking=False):
        return
    try:
        if now - _last_cleanup.get(key, 0) < 3600:
            return
        # Bounded batches; never expire idempotency receipts or queued writes.
        for table, identifier, column, cutoff in (
            ('sessions', 'token', 'expires', now),
            ('attempts', 'key', 'until', now - 86400),
        ):
            connection.execute(f'DELETE FROM {table} WHERE {identifier} IN (SELECT {identifier} FROM {table} WHERE {column}<? ORDER BY {column} LIMIT 500)', (cutoff,))
        connection.execute('DELETE FROM push_deliveries WHERE (subscription_id,slot) IN (SELECT subscription_id,slot FROM push_deliveries WHERE created<? ORDER BY created LIMIT 500)', (now-30*86400,))
        expiration = "CAST(CAST(payload AS jsonb)->>'expires' AS DOUBLE PRECISION)" if postgres else "json_extract(payload, '$.expires')"
        connection.execute(f"DELETE FROM records WHERE (kind,id) IN (SELECT kind,id FROM records WHERE kind LIKE '%:trash' AND {expiration}<? LIMIT 500)", (now,))
        _last_cleanup[key] = now
        return True
    finally:
        _cleanup_lock.release()




def migrate(connection, postgres=False):
    """Forward-only, transactional migration; never discard legacy user data."""
    connection.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)')
    if connection.execute('SELECT 1 FROM schema_migrations WHERE version=1').fetchone():
        return
    # Existing orphaned credentials indicate corruption: roll back and require
    # explicit repair rather than silently deleting data during a deployment.
    for table in ('sessions', 'recovery'):
        if connection.execute(f'SELECT 1 FROM {table} t LEFT JOIN users u ON u.id=t.user_id WHERE u.id IS NULL LIMIT 1').fetchone():
            raise RuntimeError(f'Migration 1 blocked: orphaned {table}; back up and repair before retrying')
    owner_expression = "CASE WHEN instr(kind, ':') > 0 THEN substr(kind,1,instr(kind, ':')-1) ELSE NULL END"
    if postgres:
        owner_expression = owner_expression.replace('instr(', 'strpos(')
    if connection.execute(f'SELECT 1 FROM records r LEFT JOIN users u ON u.id=({owner_expression}) WHERE ({owner_expression}) IS NOT NULL AND u.id IS NULL LIMIT 1').fetchone():
        raise RuntimeError('Migration 1 blocked: orphaned records; back up and repair before retrying')
    if connection.execute('SELECT 1 FROM operations o LEFT JOIN users u ON u.id=o.owner WHERE u.id IS NULL LIMIT 1').fetchone():
        raise RuntimeError('Migration 1 blocked: orphaned operations; back up and repair before retrying')
    if postgres:
        connection.execute(f'ALTER TABLE records ADD COLUMN owner_id TEXT GENERATED ALWAYS AS ({owner_expression}) STORED')
        connection.execute('ALTER TABLE records ADD CONSTRAINT records_user_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE')
        connection.execute('ALTER TABLE operations ADD CONSTRAINT operations_user_fk FOREIGN KEY (owner) REFERENCES users(id) ON DELETE CASCADE')
        for table in ('sessions', 'recovery'):
            connection.execute(f'ALTER TABLE {table} ADD CONSTRAINT {table}_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE')
    else:
        # SQLite cannot ALTER ADD a foreign key. Rebuild only credential tables
        # inside the startup transaction, preserving every validated row.
        connection.execute('CREATE TABLE sessions_v1 (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires DOUBLE PRECISION NOT NULL)')
        connection.execute('INSERT INTO sessions_v1 SELECT token,user_id,expires FROM sessions')
        connection.execute('DROP TABLE sessions')
        connection.execute('ALTER TABLE sessions_v1 RENAME TO sessions')
        connection.execute('CREATE TABLE recovery_v1 (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL)')
        connection.execute('INSERT INTO recovery_v1 SELECT user_id,code_hash FROM recovery')
        connection.execute('DROP TABLE recovery')
        connection.execute('ALTER TABLE recovery_v1 RENAME TO recovery')
        connection.execute(f'ALTER TABLE records ADD COLUMN owner_id TEXT GENERATED ALWAYS AS ({owner_expression}) VIRTUAL REFERENCES users(id) ON DELETE CASCADE')
        connection.execute('CREATE TABLE operations_v1 (owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, op TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(owner,op))')
        connection.execute('INSERT INTO operations_v1 SELECT owner,op,digest,response FROM operations')
        connection.execute('DROP TABLE operations')
        connection.execute('ALTER TABLE operations_v1 RENAME TO operations')
    for statement in (
        'CREATE INDEX IF NOT EXISTS records_owner ON records(owner_id)',
        'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
        'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires)',
        'CREATE INDEX IF NOT EXISTS attempts_expiry ON attempts(until)',
        'CREATE INDEX IF NOT EXISTS push_deliveries_created ON push_deliveries(created)',
    ):
        connection.execute(statement)
    connection.execute('INSERT INTO schema_migrations VALUES (1)')


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
        started = time.perf_counter()
        try:
            return self.connection.execute(self.query(query, parameters is not None), parameters)
        finally:
            elapsed = time.perf_counter() - started
            if elapsed >= 0.25:
                # Fingerprints only: SQL text, bound values and DATABASE_URL stay private.
                logging.getLogger('uvicorn.error').warning('slow_sql fingerprint=%s duration_ms=%d', hashlib.sha256(query.encode()).hexdigest()[:16], elapsed * 1000)

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
            connection.execute('PRAGMA foreign_keys=ON')
            with connection:
                connection.execute('BEGIN IMMEDIATE')
                for statement in SCHEMA:
                    connection.execute(statement)
                migrate(connection)
                cleanup(connection, str(sqlite_path))
            with connection:
                yield connection
        finally:
            connection.close()
        return
    # Never silently fall back to disposable SQLite on a remote DB failure.
    options = psycopg.conninfo.conninfo_to_dict(url)
    options.setdefault('sslmode', 'require')
    options['connect_timeout'] = 10
    with postgres_slot(), psycopg.connect(**options, prepare_threshold=None) as connection:
        connection.execute("SET LOCAL statement_timeout = '15s'")
        connection.execute("SET LOCAL lock_timeout = '5s'")
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
                    migrate(connection, postgres=True)
                    connection.commit()
                    _initialized.add(url)
        connection.execute('SET LOCAL search_path TO fittrack')
        connection.execute("SET LOCAL statement_timeout = '15s'")
        connection.execute("SET LOCAL lock_timeout = '5s'")
        connection.execute("SET LOCAL idle_in_transaction_session_timeout = '30s'")
        adapter = PostgresConnection(connection)
        if cleanup(adapter, url, postgres=True):
            connection.commit()
            connection.execute('SET LOCAL search_path TO fittrack')
            connection.execute("SET LOCAL statement_timeout = '15s'")
            connection.execute("SET LOCAL lock_timeout = '5s'")
            connection.execute("SET LOCAL idle_in_transaction_session_timeout = '30s'")
        yield adapter
