"""Read-only dependency scans with fail-closed, expiring advisory exceptions."""
import argparse
from datetime import date, timedelta
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def exceptions(path, today):
    entries = json.loads(path.read_text())
    if not isinstance(entries, list):
        raise ValueError('Exceptions must be a list')
    result = set()
    for item in entries:
        if set(item) != {'ecosystem', 'package', 'version', 'advisory', 'reason', 'owner', 'expires'}:
            raise ValueError('Every exception requires scope, reason, owner and expiry')
        if any(not isinstance(v, str) or not v.strip() for v in item.values()):
            raise ValueError('Exception fields must be non-empty strings')
        if item['ecosystem'] not in ('npm', 'python') or '*' in item['version']:
            raise ValueError('Exception must identify an ecosystem and exact version')
        if not today < date.fromisoformat(item['expires']) <= today + timedelta(days=30):
            raise ValueError('Exception expired or review date is more than 30 days away')
        key = tuple(item[k] for k in ('ecosystem', 'package', 'version', 'advisory'))
        if key in result:
            raise ValueError('Duplicate exception')
        result.add(key)
    return result


def findings(ecosystem, report, lock=None):
    if not isinstance(report, dict) or 'error' in report:
        raise ValueError('Scanner did not return a complete report')
    found = set()
    if ecosystem == 'python':
        deps = report['dependencies']
        if not isinstance(deps, list) or not deps:
            raise ValueError('Python dependency inventory missing')
        for dep in deps:
            if 'skip_reason' in dep:
                raise ValueError('Python dependency collection was incomplete')
            for vuln in dep['vulns']:
                # pip-audit does not provide a uniform severity field. Gate every advisory.
                found.add((ecosystem, dep['name'], dep['version'], vuln['id']))
    else:
        if report['auditReportVersion'] != 2 or not isinstance(report['vulnerabilities'], dict):
            raise ValueError('Unsupported npm audit report')
        for name, vuln in report['vulnerabilities'].items():
            if vuln['severity'] not in ('high', 'critical'):
                continue
            advisories = []
            for via in vuln['via']:
                if isinstance(via, dict):
                    match = re.search(r'GHSA-[a-z0-9-]+', via.get('url', ''))
                    advisories.append(match.group() if match else str(via['source']))
                else:
                    advisories.append('via:' + via)
            if not advisories or not vuln['nodes']:
                raise ValueError('Incomplete npm advisory')
            for node in vuln['nodes']:
                version = lock['packages'][node]['version']
                found.update((ecosystem, name, version, advisory) for advisory in advisories)
    return found


def enforce(found, accepted):
    for item in sorted(found):
        print(('ACCEPTED (temporary)' if item in accepted else 'BLOCKED'), *item)
    blocked = found - accepted
    print(f'Dependency gate: {len(blocked)} blocking findings')
    return 1 if blocked else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('ecosystem', choices=['npm', 'python'])
    args = parser.parse_args()
    try:
        accepted = exceptions(ROOT / '.github/dependency-exceptions.json', date.today())
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'audit.json'
            if args.ecosystem == 'npm':
                command = ['npm', 'audit', '--package-lock-only', '--ignore-scripts', '--audit-level=high', '--json']
                run = subprocess.run(command, cwd=ROOT / 'frontend', capture_output=True, timeout=480)
                report = json.loads(run.stdout)
                lock = json.loads((ROOT / 'frontend/package-lock.json').read_text())
            else:
                command = [sys.executable, '-m', 'pip_audit', '-r', 'backend/requirements-dev.txt',
                           '--strict', '--progress-spinner', 'off', '--format', 'json', '--output', str(output)]
                run = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=480)
                report = json.loads(output.read_text())
                lock = None
            if run.returncode not in (0, 1):
                raise ValueError('Scanner failed')
            found = findings(args.ecosystem, report, lock)
            if run.returncode == 1 and not found:
                raise ValueError('Scanner failed without a complete finding')
            return enforce(found, accepted)
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired):
        # Raw scanner failures may include registry credentials or environment-derived URLs.
        print('Dependency scan incomplete or policy invalid; gate failed. Check scanner availability and policy.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
