"""Read-only smoke check of the frontend and its same-origin API proxy."""
import argparse
import json
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse


def check(origin):
    parsed = urlparse(origin)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Supply an origin without credentials or a path')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost')):
        raise ValueError('HTTPS required except for disposable local tests')
    origin = origin.rstrip('/')
    def get(path, status=200):
        request = urllib.request.Request(origin+path, headers={'Cache-Control':'no-cache'})
        try:
            response = urllib.request.urlopen(request, timeout=90)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == status, f'{path}: unexpected status {response.status}'
            return response.read(), response.headers
    started = time.perf_counter()
    html, headers = get('/')
    assert 'no-store' in headers.get('Cache-Control','')
    html = html.decode()
    release, _ = get('/version.json')
    version = json.loads(release)['version']
    assert f'content="{version}"' in html
    worker, _ = get('/service-worker.js')
    assert version in worker.decode()
    assets = re.findall(r'(?:src|href)="(/assets/[^" ]+\.(?:js|css))"', html)
    assert assets
    for path in assets:
        data, asset_headers = get(path)
        assert data and 'text/html' not in asset_headers.get('Content-Type','')
    data, _ = get('/api')
    assert isinstance(json.loads(data), dict)
    _, auth_headers = get('/api/auth/me', 401)
    assert 'no-store' in auth_headers.get('Cache-Control','')
    print(json.dumps({'passed':True,'release':version,'assets':len(assets),'duration_seconds':round(time.perf_counter()-started,2)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('origin')
    args = parser.parse_args()
    check(args.origin)
