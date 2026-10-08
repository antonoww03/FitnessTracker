"""Real PostgreSQL pool guarantees; only the disposable test database is allowed."""
import os
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import psycopg
import pytest
from backend import pg_pool, server, storage

pytestmark = pytest.mark.skipif(not os.getenv('FITTRACK_TEST_POSTGRES_URL'), reason='Requires local PostgreSQL')


@pytest.fixture
def pool(monkeypatch):
    pg_pool.close()
    pg_pool.start()
    monkeypatch.setenv('FITTRACK_DB_MAX_CONNECTIONS', '1')
    value = pg_pool.get_pool(os.environ['FITTRACK_TEST_POSTGRES_URL'])
    yield value
    pg_pool.close()
    pg_pool.start()


def test_reuse_rollback_and_session_reset(pool):
    with server.database() as db:
        pid = db.execute('SELECT pg_backend_pid()').fetchone()[0]
        db.execute("SET SESSION search_path TO public")
        db.execute("SET SESSION statement_timeout='1s'")
    with pytest.raises(psycopg.errors.DivisionByZero):
        with server.database() as db:
            assert db.execute('SELECT pg_backend_pid()').fetchone()[0] == pid
            assert db.execute('SHOW search_path').fetchone()[0] == 'fittrack'
            assert db.execute('SHOW statement_timeout').fetchone()[0] == '15s'
            assert db.execute('SHOW lock_timeout').fetchone()[0] == '5s'
            assert db.execute('SHOW idle_in_transaction_session_timeout').fetchone()[0] == '30s'
            db.execute("INSERT INTO app_settings VALUES ('pool-abort','value')")
            db.execute('SELECT 1/0')
    with server.database() as db:
        assert db.execute('SELECT pg_backend_pid()').fetchone()[0] == pid
        assert db.execute("SELECT value FROM app_settings WHERE key='pool-abort'").fetchone() is None
    assert pool.get_stats()['connections_num'] == 1


def test_exhaustion_is_bounded_and_recovers(pool):
    with server.database():
        started = time.monotonic()
        with pytest.raises(storage.DatabaseBusy):
            with server.database():
                pass
        assert 1.5 < time.monotonic()-started < 4
    with server.database() as db:
        assert db.execute('SELECT 1').fetchone() == (1,)
    assert pool.get_stats()['pool_size'] <= 1


def test_broken_connection_replaced(pool):
    with server.database() as db:
        pid = db.execute('SELECT pg_backend_pid()').fetchone()[0]
    with psycopg.connect(os.environ['FITTRACK_TEST_POSTGRES_URL'], autocommit=True) as killer:
        assert killer.execute('SELECT pg_terminate_backend(%s)', (pid,)).fetchone()[0]
    with server.database() as db:
        assert db.execute('SELECT pg_backend_pid()').fetchone()[0] != pid
    assert pool.get_stats()['connections_num'] >= 2


def test_shutdown_and_restart(pool):
    with server.database():
        pass
    pg_pool.close()
    assert pool.closed
    with pytest.raises(storage.DatabaseBusy):
        with server.database():
            pass
    pg_pool.start()
    with server.database() as db:
        assert db.execute('SELECT 1').fetchone() == (1,)


def test_parallel_checkout_respects_maximum(pool):
    def read(_):
        with server.database() as db:
            db.execute('SELECT pg_sleep(0.01)')
            return db.execute('SELECT pg_backend_pid()').fetchone()[0]
    with ThreadPoolExecutor(max_workers=8) as workers:
        pids = list(workers.map(read, range(24)))
    assert len(set(pids)) == 1
    assert pool.get_stats()['pool_size'] == 1


def test_acquisition_failure_has_safe_bounded_error(monkeypatch):
    pg_pool.close()
    pg_pool.start()
    # Closed localhost port only; never fault-inject against a provider.
    url = 'postgresql://synthetic:private-marker@127.0.0.1:1/unavailable?sslmode=disable'
    started = time.monotonic()
    try:
        with pytest.raises(storage.DatabaseBusy, match='capacity'):
            with pg_pool.connection(url):
                pass
        assert time.monotonic()-started < 4
    finally:
        pg_pool.close()
        pg_pool.start()


def test_mixed_workload_comparison(monkeypatch):
    import json
    import statistics
    from uuid import uuid4
    from datetime import date
    from threading import BoundedSemaphore
    slots = BoundedSemaphore(4)
    url = os.environ['FITTRACK_TEST_POSTGRES_URL']
    pg_pool.close()
    pg_pool.start()
    with server.database() as db:
        db.execute("INSERT INTO users (id,username,salt,password) VALUES ('pool-load','pool-load','salt','hash')")
        rows = [('pool-load:water',str(i),'2026-10-01',json.dumps({'id':str(i),'date':'2026-10-01','amount_ml':250})) for i in range(1000)]
        db.executemany('INSERT INTO records(kind,id,date,payload) VALUES (?,?,?,?)',rows)
    @contextmanager
    def fresh(target):
        options = psycopg.conninfo.conninfo_to_dict(target)
        options.setdefault('sslmode', 'require')
        with slots, psycopg.connect(**options, connect_timeout=10, prepare_threshold=None) as db:
            yield db
    pooled = pg_pool.connection
    def run(factory):
        monkeypatch.setattr(pg_pool, 'connection', factory)
        def operation(i):
            token = server.CURRENT_USER.set('pool-load')
            started = time.perf_counter()
            try:
                if i % 4 == 0:
                    server.save('water', {'id':str(uuid4()),'date':'2026-10-01','amount_ml':250})
                elif i % 4 == 1:
                    assert server.backup().status_code == 200
                elif i % 4 == 2:
                    assert len(server.history(date(2026,10,1),date(2026,10,1),limit=50)) == 50
                else:
                    assert server.summary(date(2026,10,1))['total_water_ml'] >= 250000
                return (time.perf_counter()-started)*1000
            finally:
                server.CURRENT_USER.reset(token)
        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=8) as workers:
            timings = list(workers.map(operation,range(64)))
        return {'median_ms':round(statistics.median(timings),2),'p95_ms':round(sorted(timings)[60],2),'total_ms':round((time.perf_counter()-started)*1000,2)}
    rounds = []
    for i in range(3):
        modes = [('fresh',fresh),('pooled',pooled)]
        if i % 2:
            modes.reverse()
        rounds.append({name:run(factory) for name,factory in modes})
    result = {'rounds':rounds,'stats':pg_pool.stats()}
    assert result['stats']['pool_size'] <= 4
    assert result['stats'].get('requests_errors',0) == 0
    # Compare measured values; don't impose a noisy shared-runner speedup ratio.
    print('POOL_BENCHMARK '+json.dumps(result,sort_keys=True))
    pg_pool.close()
    pg_pool.start()
