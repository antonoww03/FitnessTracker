"""Read-only, bounded monitoring. Never print provider bodies or exception text."""
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
import re
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request


class MonitorError(Exception):
    """An observation failed; this is not evidence that production is healthy."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get_json(url, *, headers=None, timeout=30, limit=65536):
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', **(headers or {})})
    started = time.monotonic()
    try:
        response = urllib.request.build_opener(NoRedirect).open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise MonitorError()
        try:
            data = json.loads(body)
        except (ValueError, UnicodeError):
            data = None
        return response.status, data, response.headers, (time.monotonic() - started) * 1000


def origin_value(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise MonitorError()
    return value.rstrip('/')


@dataclass(frozen=True)
class Sample:
    status: int = 0
    healthy: bool = False
    elapsed_ms: float = 0
    app_ms: float | None = None
    request_id: str | None = None


def sample(origin, timeout, fetch=get_json):
    try:
        status, body, headers, elapsed = fetch(origin + '/api', timeout=timeout)
        match = re.search(r'(?:^|,)\s*app;dur=(\d+(?:\.\d+)?)\s*(?:,|$)', headers.get('Server-Timing', ''))
        request_id = headers.get('X-Request-ID', '')
        return Sample(status, status == 200 and isinstance(body, dict) and body.get('status') == 'ok',
                      elapsed, float(match[1]) if match else None,
                      request_id if re.fullmatch(r'[a-f0-9]{32}', request_id) else None)
    except (OSError, ValueError, MonitorError):
        return Sample()


def assess_health(samples, *, wall_ms=30000, app_ms=1000):
    """First request is excluded by caller. A lone transient never pages."""
    if len(samples) != 5:
        raise MonitorError()
    failed = sum(not item.healthy for item in samples)
    unavailable = failed >= 4 and not samples[-1].healthy and not samples[-2].healthy
    warm = [item for item in samples if item.healthy]
    slow = sum(item.elapsed_ms > wall_ms or (item.app_ms is not None and item.app_ms > app_ms) for item in warm)
    latency = len(warm) >= 4 and slow >= 4
    codes = []
    if unavailable:
        codes.append('availability')
    if latency:
        codes.append('warm_latency')
    return {'alerts': codes, 'healthy_samples': len(warm), 'failed_samples': failed,
            'server_errors': sum(item.status >= 500 for item in samples),
            'warm_median_ms': round(statistics.median(x.elapsed_ms for x in warm), 2) if warm else None,
            'app_median_ms': round(statistics.median(x.app_ms for x in warm if x.app_ms is not None), 2)
            if any(x.app_ms is not None for x in warm) else None,
            'request_ids': [x.request_id for x in samples if x.request_id][-3:]}


def probe_health(origin, *, fetch=get_json, sleep=time.sleep):
    origin = origin_value(origin)
    first = sample(origin, 90, fetch)
    # A failed wake-up gets a bounded grace period, separate from warm measurements.
    if not first.healthy:
        sleep(30)
    samples = []
    for index in range(5):
        if index:
            sleep(15)
        samples.append(sample(origin, 45, fetch))
    return {'mode': 'health', 'wake_healthy': first.healthy,
            'wake_ms': round(first.elapsed_ms, 2), **assess_health(samples)}


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError()
    return parsed.timestamp()


def assess_logs(logs, now):
    """Only application diagnostics; never raw PG errors, access logs or client payloads."""
    events = {}
    for row in logs:
        try:
            message = row['message']
            # Uvicorn prefixes structured application messages with a level label.
            event = json.loads(message[message.index('{'):])
            at = timestamp(row['timestamp'])
            status, request_id = event.get('status'), event.get('request_id', '')
            release = event.get('release', '')
            if (event.get('event') != 'server_error' or type(status) is not int or not 500 <= status <= 599
                    or not isinstance(request_id, str) or not re.fullmatch(r'[a-f0-9]{32}', request_id)
                    or not isinstance(release, str) or not re.fullmatch(r'[a-f0-9]{40}|development', release)
                    or not now - 3600 <= at <= now):
                continue
            events[request_id] = (at, status, release, request_id)
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    ordered = sorted(events.values())
    sustained = []
    for index, current in enumerate(ordered):
        window = [event for event in ordered[index:] if event[0] <= current[0] + 900]
        if len(window) >= 5 and window[-1][0] - window[0][0] >= 120:
            sustained = window
            break
    return {'mode': 'errors', 'alerts': ['sustained_server_errors'] if sustained else [],
            'server_errors': len(ordered), 'capacity_errors': sum(x[1] == 503 for x in ordered),
            'releases': list(dict.fromkeys(x[2] for x in sustained))[-3:],
            'request_ids': [x[3] for x in sustained][-3:]}


def render_logs(owner, service, token, now, fetch=get_json):
    if not re.fullmatch(r'tea-[a-z0-9]+', owner) or not re.fullmatch(r'srv-[a-z0-9]+', service) or not token:
        raise MonitorError()
    iso = lambda seconds: datetime.fromtimestamp(seconds, timezone.utc).isoformat()
    params = {'ownerId': owner, 'resource': service, 'type': 'app', 'text': 'server_error',
              'startTime': iso(now - 3600), 'endTime': iso(now), 'direction': 'forward', 'limit': 100}
    rows = []
    cursors = set()
    for _ in range(5):
        status, body, _, _ = fetch('https://api.render.com/v1/logs?' + urllib.parse.urlencode(params),
                                   headers={'Authorization': 'Bearer ' + token}, limit=1048576)
        if status != 200 or not isinstance(body, dict) or not isinstance(body.get('logs'), list):
            raise MonitorError()
        rows.extend(body['logs'])
        if len(rows) > 500 or type(body.get('hasMore')) is not bool:
            raise MonitorError()
        if not body['hasMore']:
            return rows
        cursor = (body.get('nextStartTime'), body.get('nextEndTime'))
        if cursor in cursors or not all(isinstance(x, str) for x in cursor):
            raise MonitorError()
        # Validate pagination without ever following a provider-supplied URL.
        if not now - 3600 <= timestamp(cursor[0]) <= timestamp(cursor[1]) <= now:
            raise MonitorError()
        cursors.add(cursor)
        params['startTime'], params['endTime'] = cursor
    raise MonitorError()  # Truncated observation must never produce a false green.


def emit(result):
    # Results contain only fixed codes, numbers and validated correlation identifiers.
    encoded = json.dumps(result, allow_nan=False, sort_keys=True)
    print(encoded)
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as target:
            target.write('```json\n' + encoded + '\n```\n')
    return 1 if result['alerts'] else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['health', 'errors', 'test-alert', 'test-recovery'])
    args = parser.parse_args(argv)
    try:
        if args.mode == 'health':
            result = probe_health(os.environ.get('FITNESS_PRODUCTION_ORIGIN', ''))
        elif args.mode == 'errors':
            now = time.time()
            result = assess_logs(render_logs(os.environ.get('RENDER_WORKSPACE_ID', ''),
                                             os.environ.get('RENDER_SERVICE_ID', ''),
                                             os.environ.get('RENDER_MONITOR_API_KEY', ''), now), now)
        else:
            # Safe notification drill: no network or production mutation.
            result = {'mode': args.mode, **assess_health([Sample(503) if args.mode == 'test-alert'
                                                         else Sample(200, True, 100, 50)] * 5)}
        return emit(result)
    except Exception:
        # Provider failures, invalid config, timeouts, truncation: fail visibly without secrets.
        return emit({'mode': args.mode, 'alerts': ['monitor_unavailable']})


if __name__ == '__main__':
    raise SystemExit(main())
