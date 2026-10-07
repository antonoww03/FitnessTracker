import logging
from backend import pg_pool


def test_library_errors_do_not_expose_connection_details(caplog):
    logger = logging.getLogger('psycopg.pool')
    with caplog.at_level(logging.WARNING, logger='psycopg.pool'):
        try:
            raise ValueError('postgresql://private-user:private-secret@private-host/db')
        except ValueError:
            logger.exception('connection failed: %s', 'private-secret')
    assert 'db_pool event=library_error' in caplog.text
    assert 'private-' not in caplog.text
    assert 'Traceback' not in caplog.text
