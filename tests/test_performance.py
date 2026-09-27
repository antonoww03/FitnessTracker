"""Portable query-plan and API latency gates on a disposable, populated DB."""
import json
import time
import threading
import pytest
from backend import server, storage
from tests.test_features import clients, DAY


def test_history_uses_date_index_and_bounded_range(clients):
    a, _ = clients
    owner = a.get('/api/auth/me').json()['id']
    rows = [(owner+':water', f'perf-{i}', '2020-01-01', json.dumps({'id':f'perf-{i}','date':'2020-01-01','amount_ml':1})) for i in range(10000)]
    with server.database() as db:
        db.executemany('INSERT INTO records(kind,id,date,payload) VALUES (?,?,?,?)', rows)
        query = 'SELECT payload FROM records WHERE kind=? AND date>=? AND date<=?'
        if storage.postgres_enabled():
            db.execute('ANALYZE records')
            plan = str(db.execute('EXPLAIN '+query, (owner+':water', DAY, DAY)).fetchall())
        else:
            plan = str(db.execute('EXPLAIN QUERY PLAN '+query, (owner+':water', DAY, DAY)).fetchall())
        assert 'records_date' in plan
    timings = []
    for _ in range(5):
        start = time.perf_counter()
        result = a.get('/api/history', params={'start':DAY,'end':DAY})
        timings.append(time.perf_counter()-start)
        assert result.status_code == 200 and result.json() == []
    assert sorted(timings)[2] < 1.0, f'History median exceeded 1s: {timings}'


def test_connection_capacity_recovers_after_exception(monkeypatch):
    monkeypatch.setattr(storage, '_pg_slots', threading.BoundedSemaphore(1))
    with pytest.raises(ValueError):
        with storage.postgres_slot():
            raise ValueError('test rollback')
    with storage.postgres_slot():
        with pytest.raises(storage.DatabaseBusy):
            with storage.postgres_slot():
                pass
    with storage.postgres_slot():
        pass


def test_cleanup_preserves_receipts_and_live_sessions(clients):
    a, _ = clients
    owner = a.get('/api/auth/me').json()['id']
    with server.database() as db:
        db.execute('INSERT INTO sessions VALUES (?,?,?)', ('expired-test',owner,0))
        db.execute('INSERT INTO operations VALUES (?,?,?,?)', (owner,'retained-operation','digest','{}'))
        db.execute('INSERT INTO attempts VALUES (?,1,?)', ('expired-test',0))
        storage.cleanup(db, 'test-cleanup-'+owner, postgres=storage.postgres_enabled())
        assert not db.execute('SELECT 1 FROM sessions WHERE token=?', ('expired-test',)).fetchone()
        assert not db.execute('SELECT 1 FROM attempts WHERE key=?', ('expired-test',)).fetchone()
        assert db.execute('SELECT 1 FROM operations WHERE owner=?', (owner,)).fetchone()
    assert a.get('/api/auth/me').status_code == 200


def test_capacity_failure_in_auth_returns_retryable_status(clients, monkeypatch):
    a, _ = clients
    def unavailable(_):
        raise storage.DatabaseBusy()
    monkeypatch.setattr(server, 'session_user', unavailable)
    response = a.get('/api/profile')
    assert response.status_code == 503
    assert response.headers['retry-after'] == '2'
    assert 'no-store' in response.headers['cache-control']
