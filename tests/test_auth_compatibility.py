"""Rollback bridge for the explicitly planned additive email account schema."""
import secrets
import pytest
from backend import server, storage
from tests.test_features import clients


def test_known_email_schema_preserves_accounts_and_registration(clients):
    a, _ = clients
    with server.database() as db:
        db.execute('ALTER TABLE users ADD COLUMN email TEXT')
        db.execute('CREATE UNIQUE INDEX users_email_unique ON users(email)')
        db.execute("UPDATE users SET email='alice@example.com' WHERE username='alice'")
        db.execute('INSERT INTO schema_migrations VALUES (2)')
    try:
        with server.database() as db:
            storage.migrate(db, postgres=storage.postgres_enabled())
        assert a.post('/api/auth/login', json={'username':'alice','password':'a-unique-password-123'}).status_code == 200
        response = a.post('/api/auth/register', json={'username':'charlie','password':'a-unique-password-123'})
        assert response.status_code == 200
        with server.database() as db:
            assert db.execute("SELECT email FROM users WHERE username='alice'").fetchone()[0] == 'alice@example.com'
            assert db.execute("SELECT email FROM users WHERE username='charlie'").fetchone()[0] is None
    finally:
        with server.database() as db:
            db.execute('DELETE FROM schema_migrations WHERE version=2')
            db.execute('DROP INDEX users_email_unique')
            db.execute('ALTER TABLE users DROP COLUMN email')


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


def test_bridge_does_not_change_password_creation_policy(clients):
    a, _ = clients
    assert a.post('/api/auth/register',json={'username':'short','password':'Abcdef12'}).status_code == 422
    assert a.post('/api/auth/change-password',json={'password':'a-unique-password-123','new_password':'Abcdef12'}).status_code == 422
