"""Synthetic monitor regressions. No credentials or external requests."""
import json
from datetime import datetime, timezone
import pytest
from tools import production_monitor as monitor


def healthy(ms=100, app=50):
    return monitor.Sample(200, True, ms, app)


def event(at, status=503, index=0, **extra):
    return {'timestamp': datetime.fromtimestamp(at, timezone.utc).isoformat(),
            'message': 'ERROR: ' + json.dumps({'event': 'server_error', 'status': status,
                'request_id': f'{index:032x}', 'release': 'a'*40, **extra})}


def test_transient_cold_start_and_recovery():
    requests, sleeps = [], []
    def fetch(url, **kwargs):
        requests.append((url, kwargs))
        if len(requests) == 1:
            raise TimeoutError('sensitive')
        return 200, {'status': 'ok'}, {'Server-Timing':'app;dur=50'}, 100
    result = monitor.probe_health('https://example.com', fetch=fetch, sleep=sleeps.append)
    assert result['alerts'] == [] and not result['wake_healthy']
    assert len(requests) == 6 and sleeps == [30, 15, 15, 15, 15]
    assert all(x[0] == 'https://example.com/api' for x in requests)
    assert requests[0][1]['timeout'] == 90
    assert monitor.assess_health([monitor.Sample(503)]*5)['alerts'] == ['availability']
    assert monitor.assess_health([healthy()]*5)['alerts'] == []
    assert monitor.assess_health([monitor.Sample(503), *([healthy()]*4)])['alerts'] == []


def test_warm_latency_requires_window_not_outlier():
    assert monitor.assess_health([healthy(90000)] + [healthy()]*4)['alerts'] == []
    assert monitor.assess_health([healthy(31000)]*4 + [healthy()])['alerts'] == ['warm_latency']
    assert monitor.assess_health([healthy(app=1001)]*5)['alerts'] == ['warm_latency']
    assert monitor.assess_health([healthy(10000, 160)]*5)['alerts'] == []


def test_health_requires_body_not_html_or_redirect():
    for status, body in [(200,None),(200,{}),(302,{'status':'ok'}),(503,{'status':'ok'})]:
        assert not monitor.sample('https://example.com', 45, lambda *a,**k:(status,body,{},1)).healthy


@pytest.mark.parametrize('origin', ['http://example.com','https://user:secret@example.com','https://example.com/path',
                                   'https://example.com?key=secret','https://example.com#fragment','https:///'])
def test_invalid_origin_fails_before_request(origin):
    with pytest.raises(monitor.MonitorError):
        monitor.probe_health(origin, fetch=lambda *a,**k: pytest.fail('unexpected network'))


def test_error_window_dedup_exclusions_and_recovery():
    now = 10000
    rows = [event(now-200+i*30,index=i) for i in range(5)]
    result = monitor.assess_logs(rows*2, now)
    assert result['alerts'] == ['sustained_server_errors'] and result['server_errors'] == 5
    assert result['capacity_errors'] == 5
    assert len(result['request_ids']) <= 3
    assert monitor.assess_logs(rows, now+3601)['alerts'] == []
    assert monitor.assess_logs([event(now-i,index=i) for i in range(30)],now)['alerts'] == []
    assert monitor.assess_logs([event(now-i*901,index=i) for i in range(5)],now)['alerts'] == []
    noise = [event(now-i*30,status=401,index=i) for i in range(10)]
    noise += [event(now,index=20,event='client_error'),{'message':'schema pg_pgrst_no_exposed_schemas does not exist'},
              event(now,index=21,request_id='secret'),event(now,index=22,release='secret')]
    assert monitor.assess_logs(noise,now)['server_errors'] == 0
    assert monitor.assess_logs([event(now+10,index=i) for i in range(5)],now)['server_errors'] == 0


def test_render_pagination_and_no_secret_output(capsys, monkeypatch):
    now, calls = 10000, []
    iso = lambda n: datetime.fromtimestamp(n, timezone.utc).isoformat()
    def fetch(url, **kwargs):
        calls.append((url,kwargs))
        return 200, {'logs':[event(now-200+30*len(calls),index=len(calls))], 'hasMore':len(calls)==1,
                     'nextStartTime':iso(now-180),'nextEndTime':iso(now)}, {}, 1
    rows = monitor.render_logs('tea-abc','srv-abc','secret',now,fetch)
    assert len(rows) == 2 and len(calls) == 2
    assert calls[0][0].startswith('https://api.render.com/v1/logs?')
    assert calls[0][1]['headers']['Authorization'] == 'Bearer secret'
    monkeypatch.setattr(monitor,'render_logs',lambda *a,**k: (_ for _ in ()).throw(ValueError('secret')))
    assert monitor.main(['errors']) == 1
    assert 'secret' not in capsys.readouterr().out


def test_truncated_or_failed_provider_never_green():
    iso = lambda n: datetime.fromtimestamp(n, timezone.utc).isoformat()
    for body,status in [({'logs':[]},200),({'logs':[],'hasMore':False},401),
                        ({'logs':[],'hasMore':True,'nextStartTime':iso(9990),'nextEndTime':iso(10000)},200)]:
        with pytest.raises(monitor.MonitorError):
            monitor.render_logs('tea-abc','srv-abc','secret',10000,lambda *a,**k:(status,body,{},1))


def test_safe_notification_drill(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(monitor,'get_json',lambda *a,**k: pytest.fail('unexpected network'))
    summary = tmp_path/'summary'
    monkeypatch.setenv('GITHUB_STEP_SUMMARY',str(summary))
    assert monitor.main(['test-alert']) == 1
    assert monitor.main(['test-recovery']) == 0
    assert 'availability' in summary.read_text()
    assert 'test-recovery' in capsys.readouterr().out


def test_http_transport_is_bounded_and_never_follows_redirects():
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    requests = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            requests.append(self.path)
            if self.path == '/redirect':
                self.send_response(302)
                self.send_header('Location','/secret-target')
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'x'*100)
    server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        assert monitor.get_json(origin+'/redirect',headers={'Authorization':'Bearer synthetic'})[0] == 302
        assert requests == ['/redirect']
        with pytest.raises(monitor.MonitorError):
            monitor.get_json(origin+'/large',limit=32)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_logs_do_not_echo_untrusted_fields():
    rows = [event(9800+i*30,index=i,route='/api/private?secret=value',message='private health data') for i in range(5)]
    encoded = json.dumps(monitor.assess_logs(rows,10000))
    assert 'private' not in encoded and 'secret' not in encoded


def test_monitor_workflow_is_opt_in_main_only_and_read_only():
    from pathlib import Path
    workflow = Path('.github/workflows/production-monitor.yml').read_text()
    assert "github.ref == 'refs/heads/main'" in workflow
    assert "vars.FITTRACK_MONITOR_ENABLED == '1'" in workflow
    assert 'pull_request' not in workflow
    assert 'contents: read' in workflow and 'write' not in workflow
    assert "cron: '17 */6 * * *'" in workflow
    assert "cron: '47 * * * *'" in workflow
    assert 'persist-credentials: false' in workflow
