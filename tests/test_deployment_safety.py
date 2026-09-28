"""Disposable database checks for restore, schema compatibility and rollback."""
import sqlite3
import pytest
from backend import server, storage
from tests.test_features import clients, DAY, FOOD


def test_backup_roundtrip_and_account_isolation(clients):
    a, b = clients
    food = a.post('/api/food', json=FOOD).json()
    a.post('/api/water', json={'date': DAY, 'amount_ml': 350})
    archive = a.get('/api/backup').json()
    assert archive['records']['food'][0]['id'] == food['id']
    assert b.post('/api/backup/restore', json=archive).status_code == 200
    restored = b.get('/api/backup').json()['records']
    for kind, rows in archive['records'].items():
        assert [{k:v for k,v in r.items() if k != 'timestamp'} for r in restored[kind]] == [{k:v for k,v in r.items() if k != 'timestamp'} for r in rows]
    assert b.post('/api/backup/restore', json=archive).status_code == 200
    assert len(b.get('/api/food?date='+DAY).json()) == 1
    b.delete('/api/entries/food/'+food['id'])
    assert len(a.get('/api/food?date='+DAY).json()) == 1


def test_invalid_restore_changes_nothing(clients):
    a, _ = clients
    a.post('/api/food', json=FOOD)
    before = a.get('/api/backup').json()['records']
    archive = {'version':1, 'records':{'water':[{'date':DAY,'amount_ml':100}], 'food':[{'date':'invalid'}]}}
    assert a.post('/api/backup/restore', json=archive).status_code == 422
    assert a.get('/api/backup').json()['records'] == before


def test_copy_day_conflict_rolls_back_every_record(clients):
    a, _ = clients
    a.post('/api/food', json=FOOD)
    a.post('/api/weight', json={'date':DAY, 'weight_kg':70})
    target = '2026-09-18'
    a.post('/api/weight', json={'date':target, 'weight_kg':71})
    before = a.get('/api/backup').json()['records']
    assert a.post('/api/copy-day', json={'source':DAY,'target':target,'kinds':['food','weight']}).status_code == 409
    assert a.get('/api/backup').json()['records'] == before


def test_future_schema_fails_closed(tmp_path, monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.delenv('FITTRACK_REQUIRE_POSTGRES', raising=False)
    path = tmp_path/'future.sqlite3'
    with storage.connect(path) as db:
        db.execute('INSERT INTO schema_migrations VALUES (999)')
    with pytest.raises(RuntimeError, match='newer'):
        with storage.connect(path):
            pass
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT version FROM schema_migrations ORDER BY version').fetchall() == [(1,), (999,)]


def test_api_timing_and_request_id(clients):
    a, _ = clients
    response = a.get('/api/auth/me')
    assert len(response.headers['x-request-id']) == 32
    assert response.headers['server-timing'].startswith('app;dur=')
    assert float(response.headers['server-timing'].split('=')[1]) >= 0


def test_profile_stale_edit_preserves_newer_value(clients):
    a, _ = clients
    original = a.get('/api/profile')
    revision = original.headers['etag']
    first = a.put('/api/profile', json={**original.json(),'first_name':'First'}, headers={'If-Match':revision})
    assert first.status_code == 200
    second = a.put('/api/profile', json={**original.json(),'first_name':'Stale'}, headers={'If-Match':revision})
    assert second.status_code == 409
    assert a.get('/api/profile').json()['first_name'] == 'First'
    assert a.put('/api/profile', json={**first.json(),'first_name':'Next'}, headers={'If-Match':first.headers['etag']}).status_code == 200


def test_paginated_history_is_complete_and_isolated(clients):
    a, b = clients
    for i in range(7):
        assert a.post('/api/water',json={'date':DAY,'amount_ml':100+i}).status_code == 200
    seen = []
    for offset in (0,3,6):
        response = a.get('/api/history',params={'start':DAY,'end':DAY,'limit':3,'offset':offset})
        assert response.status_code == 200
        assert len(response.json()) <= 3
        seen.extend(row['id'] for row in response.json())
    assert len(set(seen)) == len(seen) == 7
    assert b.get('/api/history',params={'start':DAY,'end':DAY,'limit':3}).json() == []
    for params in ({'limit':501},{'limit':0},{'offset':-1}):
        assert a.get('/api/history',params={'start':DAY,'end':DAY,**params}).status_code == 422


def test_delete_account_removes_owned_technical_records(clients):
    a, _ = clients
    owner = a.get('/api/auth/me').json()['id']
    with server.database() as db:
        db.execute('INSERT INTO attempts VALUES (?,1,9999999999)',('diagnostics:'+owner,))
        db.execute('INSERT INTO attempts VALUES (?,1,9999999999)',('resource:'+owner+':export',))
    assert a.request('DELETE','/api/auth/account',json={'password':'a-unique-password-123','confirm_username':'alice'}).status_code == 200
    with server.database() as db:
        for table, column in [('records','owner_id'),('operations','owner'),('sessions','user_id'),('recovery','user_id')]:
            assert db.execute(f'SELECT count(*) FROM {table} WHERE {column}=?',(owner,)).fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM attempts WHERE key IN (?,?)',('diagnostics:'+owner,'resource:'+owner+':export')).fetchone()[0]==0
