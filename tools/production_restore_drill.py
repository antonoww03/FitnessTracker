"""Manual production archive drill. Never restores to a remote or occupied target.

Only aggregate status/timing is printable; tool output and database values stay private.
The source snapshot and pg_dump are read-only. Application smoke runs in a child
process with only the disposable target URL, never the production credential.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

import psycopg
from psycopg import sql

TARGET_DB = 'fittrack_test_production_restore'
TABLES = {'users', 'sessions', 'recovery', 'records', 'operations', 'attempts',
          'push_deliveries', 'app_settings', 'schema_migrations'}


# These public diagnostics are fixed labels, never exception text or DB values.
PHASES = frozenset({
    'configuration', 'target_check', 'source_connect', 'source_snapshot',
    'source_fingerprint', 'archive_dump', 'archive_restore',
    'restore_verification', 'application_smoke',
})


def report_phase(phase):
    if phase not in PHASES:
        raise ValueError('Unknown diagnostic phase')
    print(json.dumps({'phase': phase}), flush=True)


def failure_category(error):
    # Do not print SQLSTATE, exception names, messages, stderr, URLs or commands.
    for error_type, label in (
        (psycopg.errors.InvalidPassword, 'database_authentication_failed'),
        (psycopg.errors.InsufficientPrivilege, 'database_permission_denied'),
        (psycopg.errors.QueryCanceled, 'database_query_cancelled'),
        (psycopg.errors.InvalidParameterValue, 'database_parameter_rejected'),
        (psycopg.OperationalError, 'database_connection_or_operation_failed'),
        (psycopg.Error, 'database_error'),
        (subprocess.TimeoutExpired, 'subprocess_timeout'),
        (subprocess.CalledProcessError, 'subprocess_failed'),
        (AssertionError, 'application_assertion_failed'),
        (ValueError, 'validation_failed'),
        (KeyError, 'required_configuration_missing'),
        (OSError, 'system_io_failed'),
    ):
        if isinstance(error, error_type):
            return label
    return 'unexpected_failure'


def connection_options(url, *, local=False):
    parsed = urlsplit(url)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or parsed.fragment:
        raise ValueError('Invalid connection configuration')
    options = psycopg.conninfo.conninfo_to_dict(url)
    if set(options) - {'host', 'port', 'dbname', 'user', 'password', 'sslmode'}:
        raise ValueError('Unsupported connection options')
    if local:
        if options.get('host') != '127.0.0.1' or options.get('dbname') != TARGET_DB:
            raise ValueError('Target must be the disposable local restore database')
        options['sslmode'] = 'disable'
    else:
        if options.get('host') in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Production source must be remote')
        if options.get('sslmode', 'require') not in ('require', 'verify-ca', 'verify-full'):
            raise ValueError('Production source requires TLS')
        options.setdefault('sslmode', 'require')
    options['connect_timeout'] = '10'
    return options


def comparison_settings(db):
    # Transaction-local settings: never change provider/role/database defaults.
    # pg_dump preserves float precision; fingerprints must do the same.
    db.execute("SET LOCAL extra_float_digits=3")
    db.execute("SET LOCAL timezone='UTC'")
    db.execute("SET LOCAL DateStyle='ISO, YMD'")
    db.execute("SET LOCAL IntervalStyle='postgres'")
    db.execute("SET LOCAL search_path=pg_catalog")


def fingerprint(db):
    comparison_settings(db)
    names = [r[0] for r in db.execute("SELECT tablename FROM pg_tables WHERE schemaname='fittrack' ORDER BY tablename")]
    if not TABLES <= set(names):
        raise ValueError('Required application tables missing')
    result = {}
    for name in names:
        digest, count = hashlib.sha256(), 0
        # Canonical order independent of provider/local locale; stream bounded batches.
        query = sql.SQL('SELECT row_to_json(t)::text FROM fittrack.{} t ORDER BY row_to_json(t)::text COLLATE "C"').format(sql.Identifier(name))
        with db.cursor(name='restore_fingerprint') as cursor:
            cursor.execute(query)
            for (row,) in cursor:
                data = row.encode()
                digest.update(len(data).to_bytes(8, 'big'))
                digest.update(data)
                count += 1
        result[name] = (count, digest.hexdigest())
    return result


def catalog(db):
    comparison_settings(db)
    return db.execute("""SELECT c.relname, con.conname, pg_get_constraintdef(con.oid), con.convalidated
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fittrack'
        ORDER BY c.relname COLLATE "C", con.conname COLLATE "C"
        """).fetchall()


def smoke(target):
    connection_options(target, local=True)  # Guard before importing application code.
    from fastapi.testclient import TestClient
    from backend import server
    import secrets
    with TestClient(server.app, base_url='https://testserver', headers={'X-Requested-With': 'FitTrack'}) as client:
        assert client.get('/api').status_code == 200
        assert client.get('/api/auth/me').status_code == 401
        # Check restored account reads using temporary LOCAL sessions; no real password.
        with psycopg.connect(target) as db:
            owners = db.execute('SELECT id FROM fittrack.users ORDER BY id LIMIT 5').fetchall()
        for (owner,) in owners:
            token = secrets.token_hex(32)
            with psycopg.connect(target) as db:
                db.execute('INSERT INTO fittrack.sessions VALUES (%s,%s,%s)',
                           (server.session_hash(token), owner, time.time()+300))
            client.cookies.set('fittrack_session', token, domain='testserver.local', path='/api')
            for path in ('/api/auth/me', '/api/profile', '/api/history?start=2026-01-01&end=2026-12-31&limit=100', '/api/summary?date=2026-01-01'):
                assert client.get(path).status_code == 200
            with psycopg.connect(target) as db:
                db.execute('DELETE FROM fittrack.sessions WHERE token=%s', (server.session_hash(token),))
            client.cookies.clear()
        credentials = {'username': 'drill_'+secrets.token_hex(8), 'password': secrets.token_urlsafe(24)}
        assert client.post('/api/auth/register', json=credentials).status_code == 200
        assert client.post('/api/water', json={'date': '2026-01-01', 'amount_ml': 250}).status_code == 200
        assert client.get('/api/water?date=2026-01-01').json()[0]['amount_ml'] == 250
        assert client.post('/api/auth/logout').status_code == 200
        assert client.get('/api/auth/me').status_code == 401
        assert client.post('/api/auth/login', json=credentials).status_code == 200
        assert client.get('/api/auth/me').status_code == 200


def drill(source_url, target_url, container, *, synthetic=False):
    report_phase('configuration')
    target = connection_options(target_url, local=True)
    if synthetic:
        source = psycopg.conninfo.conninfo_to_dict(source_url)
        if source.get('host') != '127.0.0.1' or source.get('dbname') != 'fittrack_test':
            raise ValueError('Synthetic source must be local fittrack_test')
    else:
        source = connection_options(source_url)
    if not re.fullmatch(r'[a-f0-9]{64}', container):
        raise ValueError('Expected ephemeral PostgreSQL service container ID')
    report_phase('target_check')
    # No other application/process may use this disposable database.
    with psycopg.connect(**target) as db:
        if db.execute("SELECT 1 FROM pg_namespace WHERE nspname='fittrack'").fetchone():
            raise ValueError('Refusing occupied restore target')
    timings = {}
    start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='fittrack-private-drill-') as directory:
        archive = Path(directory)/'archive.dump'
        report_phase('source_connect')
        with psycopg.connect(**source, options='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=300000', prepare_threshold=None) as db:
            report_phase('source_snapshot')
            db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            if db.info.server_version // 10000 != 17:
                raise ValueError('This runner requires a PostgreSQL 17 source')
            db.execute("SET LOCAL timezone='UTC'")
            snapshot = db.execute('SELECT pg_export_snapshot()').fetchone()[0]
            report_phase('source_fingerprint')
            before = fingerprint(db)
            constraints = catalog(db)
            if not all(row[3] for row in constraints):
                raise ValueError('Source contains unvalidated constraints')
            env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
            for option, key in {'host':'PGHOST','port':'PGPORT','dbname':'PGDATABASE','user':'PGUSER','password':'PGPASSWORD','sslmode':'PGSSLMODE'}.items():
                if option in source:
                    env[key] = source[option]
            env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000'
            env['PGCONNECT_TIMEOUT'] = '10'
            command = ['docker', 'exec']
            for key in env:
                if key.startswith('PG'):
                    command += ['-e', key]
            # Docker's loopback is the service container for synthetic CI runs.
            command += [container, 'pg_dump', '--format=custom', '--schema=fittrack',
                        '--no-owner', '--no-acl', '--snapshot='+snapshot]
            report_phase('archive_dump')
            with archive.open('wb') as output:
                os.chmod(archive, 0o600)
                subprocess.run(command, env=env, stdout=output, stderr=subprocess.PIPE, check=True, timeout=180)
            # Release the source snapshot promptly; all subsequent writes are local.
        timings['backup_seconds'] = round(time.monotonic()-start, 2)
        start = time.monotonic()
        report_phase('archive_restore')
        with archive.open('rb') as data:
            subprocess.run(['docker','exec','-i',container,'pg_restore','-U','postgres',
                            '-d',TARGET_DB,'--single-transaction','--exit-on-error','--no-owner','--no-acl'],
                           stdin=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=180)
        timings['restore_seconds'] = round(time.monotonic()-start, 2)
        report_phase('restore_verification')
        with psycopg.connect(**target) as db:
            db.execute("SET LOCAL timezone='UTC'")
            data_match = fingerprint(db) == before
            constraints_match = catalog(db) == constraints
            print(json.dumps({'snapshot_data_match': data_match,
                              'constraints_match': constraints_match}), flush=True)
            if not data_match or not constraints_match:
                raise ValueError('Restored data or constraints differ from snapshot')
        start = time.monotonic()
        # Allowlist avoids leaking the production URL, provider keys, or worker flags.
        env = {k:os.environ[k] for k in ('PATH','HOME','LANG','LD_LIBRARY_PATH') if k in os.environ}
        env.update(DATABASE_URL=target_url, FITTRACK_REQUIRE_POSTGRES='1', FITTRACK_AUTO_BACKUP='0',
                   FITTRACK_PUSH_WORKER='0', FITTRACK_AUTO_VAPID='0', FITTRACK_COOKIE_SECURE='1',
                   PYTHON_DOTENV_DISABLED='1')
        report_phase('application_smoke')
        subprocess.run([sys.executable,'-m','tools.production_restore_drill','--smoke'], env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=120)
        timings['smoke_seconds'] = round(time.monotonic()-start, 2)
    # Never publish per-table counts, hashes, account information or archives.
    return {'passed': True, 'snapshot_data_match': True, 'constraints_match': True, **timings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--synthetic', action='store_true')
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    try:
        if args.smoke:
            smoke(os.environ['DATABASE_URL'])
        else:
            result = drill(os.environ['FITTRACK_BACKUP_SOURCE_URL'], os.environ['FITTRACK_RESTORE_TEST_URL'],
                           os.environ['POSTGRES_CONTAINER'], synthetic=args.synthetic)
            print(json.dumps(result))
    except Exception as error:
        # Neither tracebacks nor subprocess errors are safe on a public runner.
        raise SystemExit('Restore drill FAILED: ' + failure_category(error)
                         + '. No database details or tool output published.') from None


if __name__ == '__main__':
    main()
