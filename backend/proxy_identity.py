"""Verify server-to-server client identities without trusting forwarding headers."""
import hashlib
import hmac
import os
import re
import time

from fastapi import HTTPException

HEADERS = ('x-fittrack-client', 'x-fittrack-client-time', 'x-fittrack-client-signature')
HEX = re.compile(r'[a-f0-9]{64}')
MAX_AGE = 120  # Includes a cold origin startup; no dependency on browser clocks.


def configured_key():
    value = os.getenv('FITTRACK_PROXY_IDENTITY_KEY', '')
    required = os.getenv('FITTRACK_PROXY_IDENTITY_REQUIRED') == '1'
    if (required and not value) or (value and not HEX.fullmatch(value)):
        raise RuntimeError('Invalid proxy identity configuration')
    return bytes.fromhex(value) if value else None


def auth_client_identity(request):
    try:
        key = configured_key()
    except RuntimeError:
        raise HTTPException(503, 'Authentication is temporarily unavailable', headers={'Retry-After': '30'}) from None
    if key is None:
        # Local/direct hosting and staged rollout retain the existing transport policy.
        # Never use unsigned identity or forwarding headers, even in this mode.
        return request.client.host if request.client else 'unknown'
    values = [request.headers.getlist(name) for name in HEADERS]
    if any(len(value) != 1 for value in values):
        raise HTTPException(403, 'Request verification failed')
    client, timestamp, signature = [value[0] for value in values]
    if not HEX.fullmatch(client) or not HEX.fullmatch(signature) or not re.fullmatch(r'[0-9]{10}', timestamp):
        raise HTTPException(403, 'Request verification failed')
    age = time.time() - int(timestamp)
    if age < -10 or age > MAX_AGE:
        raise HTTPException(403, 'Request verification failed')
    message = '\n'.join(('v1', timestamp, request.method, request.url.path, client))
    expected = hmac.new(key, message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(403, 'Request verification failed')
    return f'proxy-v1:{client}'
