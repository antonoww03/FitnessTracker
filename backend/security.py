"""Resource limits applied before parsing and before expensive route execution."""
import asyncio
import os
import threading
import time
from starlette.responses import JSONResponse

HEAVY_SLOTS = threading.BoundedSemaphore(2)


def validate_auth_mode():
    production = (
        os.getenv('FITTRACK_ENV', '').lower() == 'production'
        or os.getenv('ENVIRONMENT', '').lower() == 'production'
        or os.getenv('RENDER') == 'true'
        or bool(os.getenv('RENDER_EXTERNAL_URL'))
        or os.getenv('VERCEL') == '1'
        or os.getenv('FITTRACK_REQUIRE_POSTGRES') == '1'
        or bool(os.getenv('DATABASE_URL', '').strip())
    )
    if production and os.getenv('FITTRACK_AUTH_DISABLED') == '1':
        raise RuntimeError('Authentication cannot be disabled in a production or PostgreSQL deployment')


def heavy_policy(path, method):
    if path == '/api/food/analyze' and method == 'POST':
        return 'analyze', 20
    if path.startswith('/api/food/barcode/') and method == 'GET':
        return 'barcode', 60
    if path in ('/api/export', '/api/backup') and method == 'GET':
        return 'export', 10
    if path == '/api/backup/restore' and method == 'POST':
        return 'restore', 3
    return None


def consume_budget(database, owner, policy):
    operation, limit = policy
    now = time.time()
    key = f'resource:{owner}:{operation}'
    with database() as db:
        row = db.execute('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN attempts.until<=? THEN 1 ELSE attempts.count+1 END, until=CASE WHEN attempts.until<=? THEN excluded.until ELSE attempts.until END RETURNING count', (key, now+60, now, now)).fetchone()
    return row[0] <= limit


class RequestBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope.get('path', '').startswith('/api'):
            return await self.app(scope, receive, send)
        limit = 5_000_000 if scope['path'] == '/api/backup/restore' else 1_000_000
        async def fail(code, message):
            await JSONResponse({'detail': message}, status_code=code, headers={'Cache-Control':'private, no-store'})(scope, receive, send)
        lengths = [value for key,value in scope.get('headers', []) if key.lower() == b'content-length']
        if lengths:
            try:
                if len(lengths) != 1 or not lengths[0].isdigit():
                    return await fail(400, 'Invalid Content-Length')
                if int(lengths[0]) > limit:
                    return await fail(413, 'Request body is too large')
            except ValueError:
                return await fail(400, 'Invalid Content-Length')
        body = bytearray()
        try:
            async with asyncio.timeout(15):
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    chunk = message.get('body', b'')
                    if len(body) + len(chunk) > limit:
                        return await fail(413, 'Request body is too large')
                    body.extend(chunk)
                    if not message.get('more_body', False):
                        break
        except TimeoutError:
            return await fail(408, 'Request body timed out')
        delivered = False
        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {'type':'http.request', 'body':bytes(body), 'more_body':False}
        await self.app(scope, replay, send)
