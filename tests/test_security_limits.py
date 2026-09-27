import asyncio
import pytest
from backend import server, security
from tests.test_features import clients


@pytest.mark.parametrize("key,value", [("FITTRACK_ENV","production"),("RENDER","true"),("VERCEL","1"),("FITTRACK_REQUIRE_POSTGRES","1"),("DATABASE_URL","postgresql://example/db")])
def test_production_auth_bypass_rejected(monkeypatch, key, value):
    monkeypatch.setenv('FITTRACK_AUTH_DISABLED', '1')
    monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match='Authentication cannot'):
        security.validate_auth_mode()


def test_heavy_budget_account_isolation_and_expiry(clients, monkeypatch):
    a,b = clients
    owner = a.get('/api/auth/me').json()['id']
    other = b.get('/api/auth/me').json()['id']
    for _ in range(10):
        assert security.consume_budget(server.database, owner, ('export',10))
    assert not security.consume_budget(server.database, owner, ('export',10))
    assert security.consume_budget(server.database, other, ('export',10))
    response = a.get('/api/backup')
    assert response.status_code == 429 and response.headers['retry-after'] == '60'
    assert 'no-store' in response.headers['cache-control']
    with server.database() as db:
        db.execute('UPDATE attempts SET until=0 WHERE key=?',(f'resource:{owner}:export',))
    assert a.get('/api/backup').status_code == 200


def test_heavy_slots_release_on_failed_route(clients):
    a,_ = clients
    assert a.get('/api/export?format=invalid').status_code == 400
    assert security.HEAVY_SLOTS.acquire(False)
    assert security.HEAVY_SLOTS.acquire(False)
    try:
        response = a.get('/api/backup')
        assert response.status_code == 503 and response.headers['retry-after'] == '2'
    finally:
        security.HEAVY_SLOTS.release()
        security.HEAVY_SLOTS.release()
    assert a.get('/api/backup').status_code == 200


def test_body_limit_before_parsing(clients):
    a,_ = clients
    response = a.post('/api/auth/login', content=b'x'*1_000_001)
    assert response.status_code == 413
    assert 'no-store' in response.headers['cache-control']


def test_chunked_and_misreported_length_are_limited():
    async def run(headers):
        called = False
        async def downstream(scope,receive,send):
            nonlocal called
            called = True
        chunks = iter([{'type':'http.request','body':b'x'*600000,'more_body':True}, {'type':'http.request','body':b'x'*600000,'more_body':False}])
        async def receive(): return next(chunks)
        messages = []
        async def send(message): messages.append(message)
        await security.RequestBodyLimit(downstream)({'type':'http','path':'/api/profile','headers':headers}, receive, send)
        assert not called
        assert messages[0]['status'] == 413
    asyncio.run(run([]))
    asyncio.run(run([(b'content-length',b'1')]))
