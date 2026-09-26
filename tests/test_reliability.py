"""Release, account isolation and atomic write regressions on both DB engines."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3
import pytest
from backend import server, storage
from tests.test_features import clients, DAY


def test_stale_tab_cannot_read_write_or_logout_another_account(clients):
    a, b = clients
    alice = a.get('/api/auth/me').json()['id']
    headers = {'X-FitTrack-Owner': alice, 'X-Operation-ID': 'cross-tab-operation-123'}
    for response in (
        b.post('/api/water', json={'date': DAY, 'amount_ml': 250}, headers=headers),
        b.get('/api/backup', headers=headers),
        b.post('/api/auth/logout', headers=headers),
    ):
        assert response.status_code == 409
        assert response.json()['code'] == 'account_changed'
        assert 'no-store' in response.headers['cache-control']
    assert b.get('/api/auth/me').status_code == 200
    assert b.get('/api/water?date=' + DAY).json() == []
    # Old clients remain supported; ownership is always determined by the session.
    assert a.post('/api/water', json={'date': DAY, 'amount_ml': 250}).status_code == 200


def test_concurrent_recovery_code_has_exactly_one_winner(clients):
    a, b = clients
    code = a.post('/api/auth/recovery-code', json={'password': 'a-unique-password-123'}).json()['recovery_code']
    def reset(i):
        return b.post('/api/auth/reset-password', json={
            'username': 'alice', 'password': f'new-concurrent-password-{i}', 'recovery_code': code,
        }).status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(pool.map(reset, range(4)))
    assert sorted(statuses) == [200, 400, 400, 400]
    assert a.get('/api/auth/me').status_code == 401


def test_duplicate_trash_and_undo_are_atomic(clients):
    a, _ = clients
    entry = a.post('/api/water', json={'date': DAY, 'amount_ml': 250}).json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: a.delete('/api/entries/water/' + entry['id']), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 404]
    token = next(r.json()['undo_token'] for r in responses if r.status_code == 200)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: a.post('/api/undo/' + token), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 404]
    assert sum(r['amount_ml'] for r in a.get('/api/water?date=' + DAY).json()) == 250


def test_credential_foreign_keys_and_migration_version(clients):
    with server.database() as db:
        assert db.execute('SELECT version FROM schema_migrations').fetchall() == [(1,)]
    for statement, values in [
        ('INSERT INTO sessions VALUES (?,?,?)', ('orphan-token', 'missing-user', 9999999999)),
        ('INSERT INTO recovery VALUES (?,?)', ('missing-user', 'orphan-code')),
    ]:
        with pytest.raises(storage.INTEGRITY_ERRORS):
            with server.database() as db:
                db.execute(statement, values)


def test_legacy_sqlite_migration_preserves_credentials(tmp_path, monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.delenv('FITTRACK_REQUIRE_POSTGRES', raising=False)
    path = tmp_path / 'legacy.db'
    with sqlite3.connect(path) as db:
        for statement in storage.SCHEMA:
            db.execute(statement)
        db.execute("INSERT INTO users VALUES ('owner','legacy','salt','hash')")
        db.execute("INSERT INTO sessions VALUES ('token','owner',12345)")
        db.execute("INSERT INTO recovery VALUES ('owner','code')")
    for _ in range(2):
        with storage.connect(path) as db:
            assert db.execute('SELECT * FROM sessions').fetchall() == [('token', 'owner', 12345)]
            assert db.execute('SELECT * FROM recovery').fetchall() == [('owner', 'code')]
            assert db.execute('SELECT version FROM schema_migrations').fetchall() == [(1,)]
    with storage.connect(path) as db:
        db.execute("DELETE FROM users WHERE id='owner'")
    with storage.connect(path) as db:
        assert db.execute('SELECT * FROM sessions').fetchall() == []
        assert db.execute('SELECT * FROM recovery').fetchall() == []


def test_deleted_owner_cannot_be_recreated_by_inflight_write(clients):
    a, _ = clients
    owner = a.get('/api/auth/me').json()['id']
    assert a.request('DELETE', '/api/auth/account', json={
        'password': 'a-unique-password-123', 'confirm_username': 'alice',
    }).status_code == 200
    marker = server.CURRENT_USER.set(owner)
    try:
        # Models an already-authenticated request completing after deletion.
        with pytest.raises(storage.INTEGRITY_ERRORS):
            server.save('water', {'date': DAY, 'amount_ml': 250})
    finally:
        server.CURRENT_USER.reset(marker)
    with server.database() as db:
        assert db.execute('SELECT count(*) FROM records WHERE owner_id=?', (owner,)).fetchone()[0] == 0


def test_corrupt_legacy_migration_fails_without_deleting_data(tmp_path, monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.delenv('FITTRACK_REQUIRE_POSTGRES', raising=False)
    path = tmp_path / 'corrupt.db'
    with sqlite3.connect(path) as db:
        for statement in storage.SCHEMA:
            db.execute(statement)
        db.execute("INSERT INTO sessions VALUES ('token','missing-owner',12345)")
    with pytest.raises(RuntimeError, match='orphaned sessions'):
        with storage.connect(path):
            pass
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT * FROM sessions').fetchall() == [('token','missing-owner',12345)]
        assert db.execute("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").fetchone() is None
