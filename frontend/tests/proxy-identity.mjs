import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import middleware, { config } from '../middleware.ts';
import { upstreamHeaders, identityHeaders } from '../server/proxy-identity.cjs';

const vector = JSON.parse(readFileSync(new URL('../../tests/fixtures/proxy-identity.json', import.meta.url)));
const request = headers => new Request(`https://app.example${vector.path}`, { method: 'POST', headers });
const sign = (req, ip = vector.ip) => upstreamHeaders(req, ip, vector.secret, Number(vector.timestamp) * 1000);

test('Vercel CommonJS artifact loads without requiring an ES module', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = mkdtempSync(path.join(root, '.proxy-runtime-'));
  const require = createRequire(import.meta.url);
  const old = process.env.FITTRACK_PROXY_IDENTITY_KEY;
  try {
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'),
      '--target', 'es2022', '--module', 'commonjs', '--skipLibCheck', '--types', 'node',
      '--allowJs', '--rootDir', '.', '--outDir', output,
      'middleware.ts', 'server/proxy-identity.cjs'], { cwd: root, stdio: 'pipe' });
    const source = readFileSync(path.join(output, 'middleware.js'), 'utf8');
    assert.match(source, /require\(/); // Exercise the provider's actual module format.
    // Node 24 permits some require(ESM) forms that the provider runtime rejects.
    // Reject that dependency structurally as well as invoking the compiled code.
    assert.doesNotMatch(source, /require\([^)]*\.mjs["']/);
    const deployed = require(path.join(output, 'middleware.js')).default;
    delete process.env.FITTRACK_PROXY_IDENTITY_KEY;
    assert.equal(deployed(request()).headers.get('x-middleware-next'), '1');
    process.env.FITTRACK_PROXY_IDENTITY_KEY = vector.secret;
    const response = deployed(request({ 'x-real-ip': vector.ip }));
    assert.equal(response.headers.get('x-middleware-request-x-fittrack-client'), vector.client);
    assert.equal(deployed(request()).status, 503);
  } finally {
    if (old === undefined) delete process.env.FITTRACK_PROXY_IDENTITY_KEY;
    else process.env.FITTRACK_PROXY_IDENTITY_KEY = old;
    rmSync(output, { recursive: true, force: true });
  }
});

test('shared Python/Node protocol vector; preserve application headers', () => {
  const headers = sign(request({ cookie: 'synthetic', 'x-requested-with': 'FitTrack' }));
  assert.equal(headers.get(identityHeaders[0]), vector.client);
  assert.equal(headers.get(identityHeaders[1]), vector.timestamp);
  assert.equal(headers.get(identityHeaders[2]), vector.signature);
  assert.equal(headers.get('cookie'), 'synthetic');
  assert.equal(headers.get('x-requested-with'), 'FitTrack');
  assert.ok(!JSON.stringify([...headers]).includes(vector.ip));
});

test('spoofed identities and XFF cannot partition a platform client budget', () => {
  const original = sign(request());
  const forged = sign(request({
    ...Object.fromEntries(identityHeaders.map(name => [name, 'forged'])),
    'x-forwarded-for': '203.0.113.8, 203.0.113.9',
  }));
  for (const name of identityHeaders) assert.equal(forged.get(name), original.get(name));
  assert.notEqual(sign(request(), '192.0.2.11').get(identityHeaders[0]), vector.client);
  assert.equal(sign(request(), '2001:db8::1').get(identityHeaders[0]),
    sign(request(), '2001:0DB8:0:0:0:0:0:1').get(identityHeaders[0]));
});

test('staged rollout strips inbound signatures; malformed platform input fails closed', () => {
  const headers = upstreamHeaders(request(Object.fromEntries(identityHeaders.map(name => [name, 'forged']))), undefined, '');
  for (const name of identityHeaders) assert.equal(headers.has(name), false);
  for (const ip of [undefined, '', 'unknown', '192.0.2.1, 192.0.2.2']) {
    assert.throws(() => sign(request(), ip || ''), /platform/);
  }
  assert.throws(() => upstreamHeaders(request(), vector.ip, 'weak'), /configuration/);
});

test('middleware sends signatures upstream only and retains the static proxy flow', () => {
  const old = process.env.FITTRACK_PROXY_IDENTITY_KEY;
  try {
    process.env.FITTRACK_PROXY_IDENTITY_KEY = vector.secret;
    const response = middleware(request({ 'x-real-ip': vector.ip }));
    assert.equal(config.matcher, '/api/auth/:path*');
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(response.headers.get('x-middleware-request-x-fittrack-client'), vector.client);
    for (const name of identityHeaders) assert.equal(response.headers.has(name), false);
    const failed = middleware(request());
    assert.equal(failed.status, 503);
    assert.match(failed.headers.get('cache-control'), /no-store/);
    assert.equal(failed.headers.get('retry-after'), '30');
  } finally {
    if (old === undefined) delete process.env.FITTRACK_PROXY_IDENTITY_KEY;
    else process.env.FITTRACK_PROXY_IDENTITY_KEY = old;
  }
});
