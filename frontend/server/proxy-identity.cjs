// Server-only. Never import this module from the browser application.
const { createHmac } = require('node:crypto');
const { isIP } = require('node:net');

const identityHeaders = [
  'x-fittrack-client', 'x-fittrack-client-time', 'x-fittrack-client-signature',
];

function upstreamHeaders(request, platformIP, secret, now = Date.now()) {
  const headers = new Headers(request.headers);
  // A caller cannot supply its own identity, including during staged rollout.
  for (const name of identityHeaders) headers.delete(name);
  if (!secret) return headers;
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid proxy configuration');
  const family = isIP(platformIP || '');
  if (!family) throw new Error('Missing platform client identity');
  const ip = family === 6 ? new URL(`http://[${platformIP}]/`).hostname : platformIP;
  const mac = value => createHmac('sha256', Buffer.from(secret, 'hex')).update(value).digest('hex');
  const client = mac(`client:${ip}`);
  const timestamp = String(Math.floor(now / 1000));
  const path = new URL(request.url).pathname;
  const signature = mac(['v1', timestamp, request.method, path, client].join('\n'));
  headers.set(identityHeaders[0], client);
  headers.set(identityHeaders[1], timestamp);
  headers.set(identityHeaders[2], signature);
  return headers;
}

module.exports = { identityHeaders, upstreamHeaders };
