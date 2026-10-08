"""One lazy, bounded PostgreSQL pool per application process."""
import atexit
from contextlib import contextmanager
import logging
import os
import threading
import time

import psycopg
from psycopg_pool import ConnectionPool, PoolClosed, PoolTimeout, TooManyRequests

_lock = threading.Lock()
_pool = None
_key = None
_stopped = False
logger = logging.getLogger('uvicorn.error')


class SafePoolLog(logging.Filter):
    def filter(self, record):
        # Library exceptions/reprs can contain connection credentials and hostnames.
        record.msg = 'db_pool event=library_%s'
        record.args = (record.levelname.lower(),)
        record.exc_info = None
        record.exc_text = None
        return True


logging.getLogger('psycopg.pool').addFilter(SafePoolLog())


def reset(connection):
    # Local transaction settings disappear on commit/rollback. Also clear any
    # accidental session settings, temp tables or advisory locks before reuse.
    connection.autocommit = True
    try:
        connection.execute('DISCARD ALL')
    finally:
        connection.autocommit = False


def get_pool(url):
    global _pool, _key
    maximum = int(os.getenv('FITTRACK_DB_MAX_CONNECTIONS', '4'))
    if maximum < 1:
        raise ValueError('FITTRACK_DB_MAX_CONNECTIONS must be positive')
    with _lock:
        if _stopped:
            raise PoolClosed('Database pool stopped')
        key = (url, maximum)
        if _pool is not None:
            if key != _key:
                raise RuntimeError('Restart required after database configuration change')
            return _pool
        options = psycopg.conninfo.conninfo_to_dict(url)
        options.setdefault('sslmode', 'require')
        options['connect_timeout'] = 10
        # Bound dead-network detection on reused sockets as well as connect().
        options.setdefault('tcp_user_timeout', 10000)
        options.setdefault('keepalives_idle', 10)
        options.setdefault('keepalives_interval', 5)
        options.setdefault('keepalives_count', 2)
        _pool = ConnectionPool(
            kwargs={**options, 'prepare_threshold': None},
            min_size=0, max_size=maximum, open=False, timeout=2,
            max_idle=60, max_lifetime=1800, reconnect_timeout=10,
            check=ConnectionPool.check_connection, reset=reset,
            name='fittrack',
        )
        _key = key
        _pool.open()
        return _pool


def warmup(url):
    # Startup may spend the existing 10s connect budget; normal capacity waits
    # remain 2s. No periodic pings or minimum connection keep-alive loop.
    with get_pool(url).connection(timeout=12):
        pass


def start():
    global _stopped
    with _lock:
        _stopped = False


def close():
    global _pool, _key, _stopped
    with _lock:
        _stopped = True
        pool, _pool, _key = _pool, None, None
    if pool is not None:
        values = pool.get_stats()
        logger.info('db_pool event=shutdown connections=%d lost=%d bad_returns=%d checkout_errors=%d',
                    values.get('connections_num',0), values.get('connections_lost',0),
                    values.get('returns_bad',0), values.get('requests_errors',0))
        pool.close(timeout=5)


def stats():
    with _lock:
        return _pool.get_stats() if _pool is not None else {}


@contextmanager
def connection(url):
    from backend.storage import DatabaseBusy
    started = time.perf_counter()
    try:
        pool = get_pool(url)
        borrowed = pool.getconn(timeout=2)
    except (PoolTimeout, TooManyRequests, PoolClosed):
        logger.warning('db_pool event=checkout_failed wait_ms=%d', (time.perf_counter()-started)*1000)
        raise DatabaseBusy('Database capacity temporarily exhausted') from None
    waited = time.perf_counter()-started
    if waited >= .25:
        values = pool.get_stats()
        logger.warning('db_pool event=checkout wait_ms=%d size=%d available=%d waiting=%d',
                       waited*1000, values['pool_size'], values['pool_available'], values['requests_waiting'])
    try:
        # psycopg's connection context closes physical connections: use an
        # explicit commit/rollback boundary and return ownership to the pool.
        try:
            yield borrowed
            borrowed.commit()
        except BaseException:
            if not borrowed.closed:
                borrowed.rollback()
            raise
    finally:
        pool.putconn(borrowed)


atexit.register(close)
