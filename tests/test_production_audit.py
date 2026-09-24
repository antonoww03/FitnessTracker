"""Production regressions, run against both SQLite and disposable PostgreSQL."""
from contextlib import contextmanager
import threading
from backend import server
from tests.test_features import clients, FOOD, DAY


def test_reports_use_one_snapshot_and_do_not_leak_between_users(clients, monkeypatch):
    a, b = clients
    a.post('/api/food', json=FOOD)
    a.post('/api/weight', json={'date':DAY, 'weight_kg':75})
    original = server.database
    calls = []
    @contextmanager
    def counted():
        calls.append(1)
        with original() as db:
            yield db
    monkeypatch.setattr(server, 'database', counted)
    result = a.get('/api/progress?start=2026-01-01&end=2026-12-31')
    assert result.status_code == 200
    assert len(result.json()) == 365
    assert len(calls) <= 2  # Session lookup + one report snapshot, independent of days.
    day = next(r for r in result.json() if r['date'] == DAY)
    assert day['totals']['calories'] == 130
    assert day['weight_average_7d'] == 75
    assert b.get('/api/reports').json() == []
    a.post('/api/food', json=FOOD)
    assert a.get('/api/summary?date='+DAY).json()['totals']['calories'] == 260


def test_session_query_runs_off_event_loop(clients, monkeypatch):
    a, _ = clients
    loop_threads, db_threads = [], []
    original = server.session_user
    original_thread = server.asyncio.to_thread
    def lookup(token):
        db_threads.append(threading.get_ident())
        return original(token)
    async def offload(fn, *args, **kwargs):
        loop_threads.append(threading.get_ident())
        return await original_thread(fn, *args, **kwargs)
    monkeypatch.setattr(server, 'session_user', lookup)
    monkeypatch.setattr(server.asyncio, 'to_thread', offload)
    assert a.get('/api/auth/me').status_code == 200
    assert db_threads and loop_threads[0] != db_threads[0]


def test_auth_errors_are_not_cacheable(clients):
    a, _ = clients
    a.cookies.clear()
    for response in [a.get('/api/auth/me'), a.post('/api/auth/login',json={}),
                     a.post('/api/auth/login',json={},headers={'Origin':'https://evil.invalid'})]:
        assert response.status_code in (401, 403, 422)
        assert 'no-store' in response.headers['cache-control']
        assert response.headers['x-content-type-options'] == 'nosniff'


def test_extreme_nutrition_and_recipe_portions_rejected_without_writes(clients):
    a, _ = clients
    assert a.post('/api/food',json={**FOOD,'calories':1e308}).status_code == 422
    recipe={'name':'Rice','portions':1e-320,'ingredients':[{'name':'Rice','grams':100,'per100':{k:FOOD[k] for k in server.MACROS}}]}
    assert a.post('/api/recipes',json=recipe).status_code == 422
    assert a.get('/api/recipes').json() == []
    assert a.get('/api/food?date='+DAY).json() == []
