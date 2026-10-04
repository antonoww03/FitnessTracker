import asyncio
import json
import time

import pytest
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from backend.proxy_probe import ProxyProbe, server_for

TOKEN = 'test-probe-token-' + 'x' * 32


def scope(peer='10.1.0.2', headers=None, **extra):
    return {'type':'http', 'method':'GET', 'path':'/api', 'scheme':'http',
            'client':(peer, 1234), 'headers':headers or [], **extra}


def call(app, request):
    async def receive():
        return {'type':'http.request','body':b''}
    async def send(message):
        pass
    asyncio.run(app(request, receive, send))


@pytest.mark.parametrize('trusted', ['127.0.0.1', '10.1.0.2'])
def test_observes_without_changing_uvicorn_trust(trusted, monkeypatch):
    events, seen = [], []
    monkeypatch.setattr('backend.proxy_probe.LOG.info', lambda _, value: events.append(json.loads(value)))
    async def app(request, receive, send):
        seen.append(request)
    probe = ProxyProbe(TOKEN, time.time()+60)
    wrapped = probe.outer(ProxyHeadersMiddleware(probe.inner(app), trusted_hosts=trusted))
    forwarded = b'198.51.100.11, 203.0.113.22'
    call(wrapped, scope(headers=[(b'x-forwarded-for',forwarded),(b'x-fittrack-proxy-probe',TOKEN.encode())]))
    assert seen[0]['client'][0] == ('203.0.113.22' if trusted=='10.1.0.2' else '10.1.0.2')
    assert all(k != b'x-fittrack-proxy-probe' for k,v in seen[0]['headers'])
    assert 'fittrack.proxy_probe' not in seen[0]
    assert events[0]['effective'] == (events[0]['forwarded'][-1] if trusted=='10.1.0.2' else events[0]['peer'])
    serialized = json.dumps(events)
    for sensitive in [TOKEN,'10.1.0.2','198.51.100.11','203.0.113.22']:
        assert sensitive not in serialized


def test_probe_is_bounded_and_does_not_log_ordinary_requests(monkeypatch):
    events, requests = [], []
    monkeypatch.setattr('backend.proxy_probe.LOG.info', lambda _, value: events.append(json.loads(value)))
    async def app(request, receive, send):
        requests.append(request)
    now = [100]
    probe = ProxyProbe(TOKEN, 200, now=lambda:now[0])
    wrapped = probe.outer(probe.inner(app))
    auth = [(b'x-fittrack-proxy-probe', TOKEN.encode())]
    for request in [scope(),scope(headers=[(b'x-fittrack-proxy-probe',b'wrong')]),
                    scope(headers=auth+auth),scope(headers=auth, path='/api/auth/login'),
                    scope(headers=auth,method='POST')]:
        call(wrapped,request)
    assert events == []
    for _ in range(15):
        call(wrapped,scope(headers=auth))
    assert len(events) == 12 and len(requests) == 20
    fresh = ProxyProbe(TOKEN, 200, now=lambda:now[0])
    now[0] = 200
    call(fresh.outer(fresh.inner(app)),scope(headers=auth))
    assert len(events) == 12


def test_malformed_forwarded_data_never_logged_raw(monkeypatch):
    events = []
    monkeypatch.setattr('backend.proxy_probe.LOG.info', lambda _, value: events.append(json.loads(value)))
    async def app(*args): pass
    probe = ProxyProbe(TOKEN, time.time()+60)
    for value in [b'secret-invalid-address', b'a'*2049, b'1.1.1.1,'*17]:
        call(probe.outer(probe.inner(app)),scope(headers=[(b'x-fittrack-proxy-probe',TOKEN.encode()),(b'x-forwarded-for',value)]))
    assert events[0]['forwarded'] == [{'kind':'invalid'}]
    assert events[1]['forwarded'] == {'kind':'missing_or_ambiguous'}
    assert events[2]['forwarded'] == {'kind':'too_many'}
    assert 'secret-invalid-address' not in json.dumps(events)


def test_environment_disabled_expiry_and_ephemeral_ids(monkeypatch):
    monkeypatch.delenv('FITTRACK_PROXY_PROBE_TOKEN', raising=False)
    monkeypatch.delenv('FITTRACK_PROXY_PROBE_UNTIL', raising=False)
    assert ProxyProbe.from_environment() is None
    monkeypatch.setenv('FITTRACK_PROXY_PROBE_TOKEN', TOKEN)
    for until in ['invalid','nan',str(time.time()-1),str(time.time()+1000)]:
        monkeypatch.setenv('FITTRACK_PROXY_PROBE_UNTIL',until)
        assert ProxyProbe.from_environment() is None
    monkeypatch.setenv('FITTRACK_PROXY_PROBE_UNTIL',str(time.time()+600))
    a,b = ProxyProbe.from_environment(),ProxyProbe.from_environment()
    assert a.address('2001:4860:4860::8888')['family'] == 6
    assert a.address('1.1.1.1') != b.address('1.1.1.1')
    assert a.address('1.1.1.1') == a.address('1.1.1.1')


def test_server_keeps_forwarded_allow_ips_environment(monkeypatch):
    async def app(*args): pass
    monkeypatch.setenv('FORWARDED_ALLOW_IPS','10.1.0.2')
    for enabled in [False,True]:
        monkeypatch.setenv('FITTRACK_PROXY_PROBE_TOKEN', TOKEN if enabled else '')
        monkeypatch.setenv('FITTRACK_PROXY_PROBE_UNTIL',str(time.time()+600))
        server = server_for(app)
        assert server.config.forwarded_allow_ips == '10.1.0.2'
        assert server.config.proxy_headers is True
