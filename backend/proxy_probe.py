"""Opt-in, bounded proxy-chain diagnostics. Never changes proxy trust or responses."""
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import secrets
import time

LOG = logging.getLogger('uvicorn.error')


class ProxyProbe:
    """One process-local comparison key, with absolute expiry across restarts."""
    def __init__(self, token, until, now=time.time):
        self.now = now
        self.token = token
        self.until = until
        self.remaining = 12
        self.key = secrets.token_bytes(32)

    @classmethod
    def from_environment(cls):
        token = os.getenv('FITTRACK_PROXY_PROBE_TOKEN', '')
        try:
            until = float(os.getenv('FITTRACK_PROXY_PROBE_UNTIL', '0'))
        except ValueError:
            return None
        if not 32 <= len(token) <= 128 or not token.isascii() or not 0 < until-time.time() <= 900:
            return None
        return cls(token, until)

    def address(self, value):
        try:
            address = ipaddress.ip_address(value)
        except ValueError:
            return {'kind': 'invalid'}
        kind = ('loopback' if address.is_loopback else
                'private' if address.is_private else
                'global' if address.is_global else 'reserved')
        digest = hmac.new(self.key, str(address).encode(), hashlib.sha256).hexdigest()[:24]
        return {'kind': kind, 'family': address.version, 'id': digest}

    def outer(self, app):
        async def wrapped(scope, receive, send):
            if scope['type'] != 'http':
                return await app(scope, receive, send)
            # Strip the diagnostic credential before the application sees headers.
            tokens = [v for k,v in scope.get('headers', []) if k.lower() == b'x-fittrack-proxy-probe']
            safe_scope = dict(scope)
            safe_scope['headers'] = [(k,v) for k,v in scope.get('headers', []) if k.lower() != b'x-fittrack-proxy-probe']
            allowed = (scope.get('method') == 'GET' and scope.get('path') in ('/api', '/api/')
                       and self.remaining > 0 and self.now() < self.until and len(tokens) == 1
                       and len(tokens[0]) <= 128 and hmac.compare_digest(tokens[0], self.token.encode()))
            if allowed:
                self.remaining -= 1
                peer = scope.get('client')
                event = {'event': 'proxy_identity_probe', 'sequence': 12-self.remaining,
                         'peer': self.address(peer[0] if peer else '')}
                forwarded = [v for k,v in scope.get('headers', []) if k.lower() == b'x-forwarded-for']
                if len(forwarded) == 1 and len(forwarded[0]) <= 2048:
                    parts = forwarded[0].decode('ascii', errors='replace').split(',')
                    event['forwarded'] = ([self.address(p.strip()) for p in parts]
                                          if len(parts) <= 16 else {'kind': 'too_many'})
                else:
                    event['forwarded'] = {'kind': 'missing_or_ambiguous'}
                safe_scope['fittrack.proxy_probe'] = event
            return await app(safe_scope, receive, send)
        return wrapped

    def inner(self, app):
        async def wrapped(scope, receive, send):
            event = scope.get('fittrack.proxy_probe')
            if event is not None:
                client = scope.get('client')
                event['effective'] = self.address(client[0] if client else '')
                LOG.info('%s', json.dumps(event, separators=(',', ':')))
                scope = dict(scope)
                scope.pop('fittrack.proxy_probe', None)
            return await app(scope, receive, send)
        return wrapped


def server_for(app, **options):
    """Wrap before and after Uvicorn's unchanged configured ProxyHeadersMiddleware."""
    import uvicorn
    probe = ProxyProbe.from_environment()
    config = uvicorn.Config(probe.inner(app) if probe else app, **options)
    if probe:
        config.load()
        config.loaded_app = probe.outer(config.loaded_app)
    return uvicorn.Server(config)
