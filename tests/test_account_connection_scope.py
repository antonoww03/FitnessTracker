"""Account security budgets must not acquire a second connection under a transaction."""
from contextlib import contextmanager
import threading
import pytest
from backend import storage, pg_pool
from tests.test_features import clients


@pytest.fixture
def single_connection(clients, monkeypatch):
    pg_pool.close()
    pg_pool.start()
    monkeypatch.setenv('FITTRACK_DB_MAX_CONNECTIONS', '1')
    yield
    pg_pool.close()
    pg_pool.start()


@pytest.mark.parametrize('action', ['change-password', 'logout-all', 'account'])
def test_account_actions_do_not_nest_checkouts(clients, single_connection, monkeypatch, action):
    client, _ = clients
    username = client.get('/api/auth/me').json()['username']
    original = storage.connect
    active = threading.local()
    @contextmanager
    def checked(path):
        assert not getattr(active, 'value', False), 'Nested database checkout'
        active.value = True
        try:
            with original(path) as db:
                yield db
        finally:
            active.value = False
    monkeypatch.setattr(storage, 'connect', checked)
    # Incorrect credentials must still commit the auth budget, without nesting.
    payload = {'password':'incorrect-password'}
    if action == 'change-password':
        payload['new_password'] = 'another-password-123'
    if action == 'account':
        payload['confirm_username'] = username
    response = client.request('DELETE' if action == 'account' else 'POST', '/api/auth/'+action, json=payload)
    assert response.status_code == 403

    payload['password'] = 'a-unique-password-123'
    response = client.request('DELETE' if action == 'account' else 'POST', '/api/auth/'+action, json=payload)
    assert response.status_code == 200
