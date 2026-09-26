import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from backend import server

pytestmark = pytest.mark.skipif(not os.getenv('FITTRACK_TEST_POSTGRES_URL'), reason='Requires local PostgreSQL')


def test_concurrent_operations_and_rollback():
    with server.database() as db:
        db.execute("INSERT INTO users VALUES ('same-owner','concurrency-test','salt','hash')")
    def write(_):
        owner = server.CURRENT_USER.set('same-owner')
        operation = server.OPERATION_ID.set('same-operation')
        try:
            return server.save('water', {'date':'2026-09-23', 'amount_ml':500})
        finally:
            server.CURRENT_USER.reset(owner)
            server.OPERATION_ID.reset(operation)
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(write, range(8)))
    assert len({r['id'] for r in results}) == 1
    with server.database() as db:
        assert db.execute('SELECT count(*) FROM records').fetchone()[0] == 1
    with pytest.raises(RuntimeError):
        with server.database() as db:
            db.execute("INSERT INTO app_settings VALUES ('rollback','test')")
            raise RuntimeError('abort')
    with server.database() as db:
        assert db.execute("SELECT value FROM app_settings WHERE key='rollback'").fetchone() is None


def test_vapid_survives_new_connections(monkeypatch):
    for key in ('VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('FITTRACK_AUTO_VAPID','1')
    first = server.vapid_configuration()
    assert first['private_key']
    assert server.vapid_configuration() == first
