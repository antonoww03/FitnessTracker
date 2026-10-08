import hashlib
import hmac
import json
import time
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend import proxy_identity, server
from tests.test_features import clients

VECTOR = json.loads((Path(__file__).parent / 'fixtures/proxy-identity.json').read_text())
KEY = VECTOR['secret']  # Public test vector, never a deployment credential.


def signed(path='/api/auth/login', method='POST', client=None, timestamp=None):
    client = client or VECTOR['client']
    timestamp = str(int(time.time())) if timestamp is None else str(timestamp)
    message = '\n'.join(('v1', timestamp, method, path, client))
    signature = hmac.new(bytes.fromhex(KEY), message.encode(), hashlib.sha256).hexdigest()
    return dict(zip(proxy_identity.HEADERS, (client, timestamp, signature)))


def request(headers, path='/api/auth/login', method='POST', peer='127.0.0.1'):
    items = headers.items() if isinstance(headers, dict) else headers
    return Request({'type': 'http', 'method': method, 'path': path, 'scheme': 'https',
                    'server': ('origin.example', 443), 'client': (peer, 1234),
                    'headers': [(k.encode(), v.encode()) for k, v in items]})


def test_shared_protocol_vector(monkeypatch):
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_KEY', KEY)
    monkeypatch.setattr(proxy_identity.time, 'time', lambda: int(VECTOR['timestamp']))
    headers = dict(zip(proxy_identity.HEADERS, (VECTOR['client'], VECTOR['timestamp'], VECTOR['signature'])))
    assert proxy_identity.auth_client_identity(request(headers)) == 'proxy-v1:' + VECTOR['client']


@pytest.mark.parametrize('mutation', ['missing', 'duplicate', 'joined', 'signature', 'client', 'expired', 'future', 'timestamp', 'method', 'path'])
def test_untrusted_identity_rejected(monkeypatch, mutation):
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_KEY', KEY)
    headers = signed()
    kwargs = {}
    if mutation == 'missing': headers = {'x-forwarded-for': '192.0.2.9', 'x-real-ip': '192.0.2.9'}
    elif mutation == 'duplicate': headers = list(headers.items()) + [('x-fittrack-client', VECTOR['client'])]
    elif mutation == 'joined': headers['x-fittrack-client'] += ', ' + VECTOR['client']
    elif mutation == 'signature': headers['x-fittrack-client-signature'] = '0' * 64
    elif mutation == 'client': headers['x-fittrack-client'] = '1' * 64
    elif mutation == 'expired': headers = signed(timestamp=int(time.time()) - 121)
    elif mutation == 'future': headers = signed(timestamp=int(time.time()) + 20)
    elif mutation == 'timestamp': headers['x-fittrack-client-time'] = 'NaN'
    elif mutation == 'method': kwargs['method'] = 'DELETE'
    elif mutation == 'path': kwargs['path'] = '/api/auth/register'
    with pytest.raises(HTTPException) as error:
        proxy_identity.auth_client_identity(request(headers, **kwargs))
    assert error.value.status_code == 403


def test_local_mode_ignores_all_forwarded_identity(monkeypatch):
    monkeypatch.delenv('FITTRACK_PROXY_IDENTITY_KEY', raising=False)
    monkeypatch.delenv('FITTRACK_PROXY_IDENTITY_REQUIRED', raising=False)
    assert proxy_identity.auth_client_identity(request({**signed(), 'x-forwarded-for': '192.0.2.9'}, peer='local-peer')) == 'local-peer'


def test_bad_configuration_never_falls_back(monkeypatch):
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_KEY', 'weak')
    with pytest.raises(RuntimeError): proxy_identity.configured_key()
    with pytest.raises(HTTPException) as error: proxy_identity.auth_client_identity(request({}))
    assert error.value.status_code == 503
    monkeypatch.delenv('FITTRACK_PROXY_IDENTITY_KEY')
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_REQUIRED', '1')
    with pytest.raises(RuntimeError): proxy_identity.configured_key()


def test_distinct_clients_share_proxy_but_not_ip_budget(clients, monkeypatch):
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_KEY', KEY)
    first = request(signed())
    for n in range(20): server.auth_attempt(first, f'first-{n}')
    with pytest.raises(HTTPException) as error: server.auth_attempt(first, 'first-21')
    assert error.value.status_code == 429
    server.auth_attempt(request(signed(client='2' * 64)), 'second')
    # Rotating forwarding headers cannot escape the verified identity's budget.
    with pytest.raises(HTTPException) as error:
        server.auth_attempt(request({**signed(), 'x-forwarded-for': '192.0.2.99'}), 'first-22')
    assert error.value.status_code == 429
    with server.database() as db:
        assert db.execute('SELECT count FROM attempts WHERE key=?', ('ip:proxy-v1:' + VECTOR['client'],)).fetchone()[0] == 22


def test_account_budget_independent_of_client_and_persistent(clients, monkeypatch):
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_KEY', KEY)
    for n in range(20): server.auth_attempt(request(signed(client=f'{n:064x}')), 'target-account')
    with pytest.raises(HTTPException) as error:
        server.auth_attempt(request(signed(client='f' * 64)), 'target-account')
    assert error.value.status_code == 429
    # Separate DB transactions/requests used above; no process-local counter.
    with server.database() as db:
        assert db.execute('SELECT count FROM attempts WHERE key=?', ('user:target-account',)).fetchone()[0] == 21


def test_unsigned_auth_cannot_consume_budget_or_create_account(clients, monkeypatch):
    a, _ = clients
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_KEY', KEY)
    response = a.post('/api/auth/register', json={'username': 'unsigned', 'password': 'A-unique-password-123'},
                      headers={'x-forwarded-for': '192.0.2.9'})
    assert response.status_code == 403
    assert 'no-store' in response.headers['cache-control']
    with server.database() as db:
        assert not db.execute('SELECT 1 FROM attempts WHERE key=?', ('user:unsigned',)).fetchone()
        assert not db.execute('SELECT 1 FROM users WHERE username=?', ('unsigned',)).fetchone()
    assert a.get('/api').status_code == 200


def test_signed_auth_session_recovery_and_deletion(clients, monkeypatch):
    a, _ = clients
    monkeypatch.setenv('FITTRACK_PROXY_IDENTITY_KEY', KEY)
    password = 'A-unique-password-123'
    def post(path, body): return a.post(path, json=body, headers=signed(path))
    assert post('/api/auth/login', {'username': 'alice', 'password': password}).status_code == 200
    code = post('/api/auth/recovery-code', {'password': password})
    assert code.status_code == 200
    assert post('/api/auth/reset-password', {'username': 'alice', 'password': password, 'recovery_code': code.json()['recovery_code']}).status_code == 200
    assert a.get('/api/auth/me').status_code == 401
    assert post('/api/auth/login', {'username': 'alice', 'password': password}).status_code == 200
    assert post('/api/auth/logout-all', {'password': password}).status_code == 200
    assert post('/api/auth/login', {'username': 'alice', 'password': password}).status_code == 200
    newer = password + '-new'
    assert post('/api/auth/change-password', {'password': password, 'new_password': newer}).status_code == 200
    assert post('/api/auth/login', {'username': 'alice', 'password': newer}).status_code == 200
    assert a.request('DELETE', '/api/auth/account', json={'password': newer, 'confirm_username': 'alice'},
                     headers=signed('/api/auth/account', method='DELETE')).status_code == 200
