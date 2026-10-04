"""Guard tests contain only fake connection credentials, never provider access."""
import pytest
from tools import production_restore_drill as drill


@pytest.mark.parametrize('url', [
    'postgresql://u:p@remote.example/fittrack_test_production_restore',
    'postgresql://u:p@127.0.0.1/postgres',
    'postgresql://u:p@127.0.0.1/fittrack_test_production_restore?options=-csearch_path%3Dpublic',
    'postgresql://u:p@127.0.0.1/fittrack_test_production_restore?host=remote.example',
])
def test_restore_target_rejected_before_database_access(url, monkeypatch):
    monkeypatch.setattr(drill.psycopg, 'connect', lambda **kw: pytest.fail('must reject before connecting'))
    with pytest.raises(ValueError):
        drill.drill('postgresql://u:p@source.example/db', url, 'a'*64)


@pytest.mark.parametrize('url', [
    'postgresql://u:p@source.example/db?sslmode=disable',
    'postgresql://u:p@source.example/db?sslmode=prefer',
    'postgresql://u:p@source.example/db?service=other',
    'postgresql://u:p@127.0.0.1/db',
    'file:///tmp/database',
])
def test_source_tls_and_options(url):
    with pytest.raises(ValueError):
        drill.connection_options(url)


def test_source_defaults_to_tls():
    assert drill.connection_options('postgresql://u:p@source.example/db')['sslmode'] == 'require'


def test_occupied_target_never_runs_dump(monkeypatch):
    class Database:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, query): return self
        def fetchone(self): return (1,)
    monkeypatch.setattr(drill.psycopg, 'connect', lambda **kw: Database())
    monkeypatch.setattr(drill.subprocess, 'run', lambda *a, **kw: pytest.fail('must not dump or restore'))
    with pytest.raises(ValueError, match='occupied'):
        drill.drill('postgresql://u:p@source.example/db',
                    'postgresql://u:p@127.0.0.1/fittrack_test_production_restore', 'a'*64)


def test_public_error_does_not_include_credentials(monkeypatch, capsys):
    monkeypatch.setattr('sys.argv', ['drill'])
    monkeypatch.setenv('FITTRACK_BACKUP_SOURCE_URL', 'secret-source')
    monkeypatch.setenv('FITTRACK_RESTORE_TEST_URL', 'secret-target')
    monkeypatch.setenv('POSTGRES_CONTAINER', 'a'*64)
    def fail(*a, **kw): raise RuntimeError('private database row and secret-source')
    monkeypatch.setattr(drill, 'drill', fail)
    with pytest.raises(SystemExit) as error:
        drill.main()
    assert 'secret' not in str(error.value)
    assert 'private database row' not in str(error.value)
    assert capsys.readouterr().out == ''
