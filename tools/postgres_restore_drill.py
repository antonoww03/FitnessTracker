"""Verify a full pg_dump restore using explicitly disposable LOCAL databases.
Never accepts a remote target or writes to the source database.
"""
import argparse
import os
import subprocess
import tempfile
from pathlib import Path
import psycopg


def local_options(url):
    options = psycopg.conninfo.conninfo_to_dict(url)
    if options.get('host') not in ('127.0.0.1', 'localhost') or not options.get('dbname', '').startswith('fittrack_test'):
        raise ValueError('Restore drills require explicitly disposable local fittrack_test* databases')
    return options


def client_environment(options):
    env = os.environ.copy()
    for name in ('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGOPTIONS'):
        env.pop(name, None)
    for key, name in {'host':'PGHOST','port':'PGPORT','dbname':'PGDATABASE','user':'PGUSER','password':'PGPASSWORD','sslmode':'PGSSLMODE'}.items():
        if key in options:
            env[name] = options[key]
    return env


def fingerprint(connection):
    tables = connection.execute("SELECT tablename FROM pg_tables WHERE schemaname='fittrack' ORDER BY tablename").fetchall()
    from psycopg import sql
    import hashlib
    result = {}
    for (table,) in tables:
        rows = connection.execute(sql.SQL('SELECT row_to_json(t)::text FROM fittrack.{} t ORDER BY row_to_json(t)::text').format(sql.Identifier(table))).fetchall()
        result[table] = (len(rows), hashlib.sha256('\n'.join(row[0] for row in rows).encode()).hexdigest())
    return result


def drill(source, target):
    source_options, target_options = local_options(source), local_options(target)
    if source_options['dbname'] == target_options['dbname']:
        raise ValueError('Source and target must be different databases')
    with psycopg.connect(target) as connection:
        if connection.execute("SELECT 1 FROM pg_namespace WHERE nspname='fittrack'").fetchone():
            raise ValueError('Target must be empty; existing schema will never be replaced')
    with psycopg.connect(source) as connection:
        before = fingerprint(connection)
    if not before:
        raise ValueError('Source has no application schema')
    with tempfile.TemporaryDirectory(prefix='fittrack-restore-') as directory:
        archive = Path(directory)/'backup.dump'
        # Credentials only in child environment; suppress tool errors that may contain secrets.
        subprocess.run(['pg_dump','--format=custom','--schema=fittrack','--no-owner','--no-acl','--file',str(archive)],env=client_environment(source_options),check=True,capture_output=True,timeout=120)
        subprocess.run(['pg_restore','--dbname',target_options['dbname'],'--single-transaction','--exit-on-error','--no-owner','--no-acl',str(archive)],env=client_environment(target_options),check=True,capture_output=True,timeout=120)
    with psycopg.connect(target) as connection:
        restored = fingerprint(connection)
    if before != restored:
        raise RuntimeError('Restored database differs from source; source must remain idle during drill')
    print(f'PASS: restored {len(restored)} tables with identical row fingerprints')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        drill(os.environ['FITTRACK_TEST_POSTGRES_URL'], os.environ['FITTRACK_RESTORE_TEST_URL'])
    except Exception:
        raise SystemExit('Restore drill failed. Check isolated DB setup and PostgreSQL client availability; no credentials printed.') from None
