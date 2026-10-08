"""Rollback bridge for the explicitly planned additive email account schema."""
import secrets
import pytest
from backend import server, storage
from tests.test_features import clients


def test_known_email_schema_preserves_accounts_and_registration(clients):
    a, _ = clients
    with server.database() as db:
        storage.migrate(db, postgres=storage.postgres_enabled())
        assert db.execute('SELECT version FROM schema_migrations ORDER BY version').fetchall() == [(1,), (2,)]
        # The bridge uses named columns and can still create legacy NULL-email accounts.
        salt = secrets.token_hex(16)
        db.execute('INSERT INTO users (id,username,salt,password) VALUES (?,?,?,?)',
                   ('legacy','legacy',salt,server.password_hash('lowercase-legacy-password',salt)))
    assert a.post('/api/auth/login',json={'username':'legacy','password':'lowercase-legacy-password'}).status_code == 200
    with server.database() as db:
        assert db.execute("SELECT email FROM users WHERE username='legacy'").fetchone()[0] is None


@pytest.mark.parametrize('action', ['recovery-code','logout-all','change-password','account'])
def test_existing_short_password_can_authorize_account_actions(clients, action):
    a, _ = clients
    password = 'Abcdef12'
    salt = secrets.token_hex(16)
    with server.database() as db:
        db.execute('UPDATE users SET salt=?,password=? WHERE username=?',
                   (salt, server.password_hash(password,salt), 'alice'))
    assert a.post('/api/auth/login',json={'username':'alice','password':'Badpass1'}).status_code == 401
    assert a.post('/api/auth/login',json={'username':'alice','password':password}).status_code == 200
    body = {'password':password}
    if action == 'change-password':
        body['new_password'] = 'another-password-123'
    if action == 'account':
        body['confirm_username'] = 'alice'
        response = a.request('DELETE','/api/auth/account',json=body)
    else:
        response = a.post('/api/auth/'+action,json=body)
    assert response.status_code == 200


def test_legacy_registration_requires_refresh_and_reset_policy_is_unchanged(clients):
    a, _ = clients
    assert a.post('/api/auth/register',json={'username':'short','password':'Abcdef12'}).status_code == 422
    assert a.post('/api/auth/change-password',json={'password':'A-unique-password-123','new_password':'Abcdef12'}).status_code == 422
