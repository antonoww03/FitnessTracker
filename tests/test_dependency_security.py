import contextlib
from datetime import date
import io
import json
from pathlib import Path
import tempfile
import unittest

from tools.dependency_security import enforce, exceptions, findings


class DependencySecurityTests(unittest.TestCase):
    def policy(self, entries):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'exceptions.json'
            path.write_text(json.dumps(entries))
            return exceptions(path, date(2026, 10, 3))

    def test_npm_gates_high_and_critical_including_transitive_paths(self):
        lock = {'packages': {'node_modules/a': {'version': '1.0.0'},
                             'node_modules/b/node_modules/a': {'version': '1.1.0'}}}
        for severity in ('low', 'moderate', 'high', 'critical'):
            with self.subTest(severity=severity):
                report = {'auditReportVersion': 2, 'vulnerabilities': {
                    'a': {'severity': severity, 'nodes': list(lock['packages']),
                          'via': [{'url': 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'}]}}}
                result = findings('npm', report, lock)
                self.assertEqual(len(result), 2 if severity in ('high', 'critical') else 0)

    def test_python_does_not_silently_drop_unscored_advisories(self):
        report = {'dependencies': [{'name': 'example', 'version': '1.0',
                                   'vulns': [{'id': 'PYSEC-2026-1'}]}]}
        found = findings('python', report)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(enforce(found, set()), 1)
            self.assertEqual(enforce(found, found), 0)
            self.assertEqual(enforce(set(), set()), 0)

    def test_incomplete_scans_fail_closed(self):
        for ecosystem, report in [('npm', {'error': {'code': 'NETWORK'}}),
                                  ('npm', {}), ('python', {}),
                                  ('python', {'dependencies': []}),
                                  ('python', {'dependencies': [{'skip_reason': 'unknown package'}]})]:
            with self.subTest(ecosystem=ecosystem, report=report):
                with self.assertRaises((ValueError, KeyError)):
                    findings(ecosystem, report, {})

    def test_exceptions_require_rationale_owner_and_near_term_expiry(self):
        entry = dict(ecosystem='python', package='example', version='1.0',
                     advisory='PYSEC-2026-1', reason='Synthetic test exception',
                     owner='maintainer', expires='2026-10-10')
        self.assertEqual(self.policy([entry]), {('python', 'example', '1.0', 'PYSEC-2026-1')})
        for changes in [{'reason': ''}, {'owner': ''}, {'version': '*'},
                        {'expires': '2026-10-03'}, {'expires': '2027-01-01'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.policy([{**entry, **changes}])
        with self.assertRaises(ValueError):
            self.policy([entry, entry])
        del entry['reason']
        with self.assertRaises(ValueError):
            self.policy([entry])

    def test_exception_cannot_cover_another_version(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(enforce({('npm', 'a', '2.0', 'GHSA-test')},
                                     {('npm', 'a', '1.0', 'GHSA-test')}), 1)


if __name__ == '__main__':
    unittest.main()
