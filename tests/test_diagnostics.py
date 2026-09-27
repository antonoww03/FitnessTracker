import json
import re
from backend import server
from tests.test_features import clients


def test_diagnostics_are_private_bounded_and_allowlisted(clients, caplog):
    a,b=clients
    body={'kind':'api','release':'development','status':500,'request_id':'a'*32}
    with caplog.at_level('WARNING',logger='uvicorn.error'):
        assert a.post('/api/diagnostics/client',json={**body,'message':'private health text'}).status_code==422
        for _ in range(30): assert a.post('/api/diagnostics/client',json=body).status_code==204
        assert a.post('/api/diagnostics/client',json=body).status_code==429
    events=[json.loads(r.message) for r in caplog.records if r.message.startswith('{')]
    assert len(events)==30
    assert all(set(e)=={'event','kind','release','status','request_id'} for e in events)
    assert 'private health text' not in str(events)
    b.cookies.clear()
    assert b.post('/api/diagnostics/client',json=body).status_code==401


def test_backend_error_has_correlation_without_exception_values(clients, monkeypatch, caplog):
    a,_=clients
    def fail(_): raise RuntimeError('SECRET_PASSWORD_AND_HEALTH_DATA')
    monkeypatch.setattr(server,'session_user',fail)
    with caplog.at_level('ERROR',logger='uvicorn.error'):
        response=a.get('/api/profile?private=SECRET_QUERY')
    assert response.status_code==500
    identifier=response.headers['x-request-id']
    assert re.fullmatch('[a-f0-9]{32}',identifier)
    assert response.json()['request_id']==identifier
    assert 'no-store' in response.headers['cache-control']
    events=[r.message for r in caplog.records if r.name=='uvicorn.error']
    assert len(events)==1 and identifier in events[0]
    assert 'SECRET' not in events[0] and 'SECRET' not in response.text
