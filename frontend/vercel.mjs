// Set Vercel's Root Directory to frontend. Keep the API on a persistent host.
const configuredOrigin = process.env.FITTRACK_API_ORIGIN?.trim();
if (!configuredOrigin) {
  throw new Error('Set FITTRACK_API_ORIGIN to the HTTPS origin of the persistent FitTrack backend (see DEPLOYMENT.md).');
}
const backend = new URL(configuredOrigin);
if (backend.protocol !== 'https:' || backend.username || backend.password ||
    backend.pathname !== '/' || backend.search || backend.hash) {
  throw new Error('FITTRACK_API_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.');
}
if ([process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].includes(backend.host)) {
  throw new Error('FITTRACK_API_ORIGIN must point to the backend, not this Vercel project.');
}
if (process.env.REACT_APP_BACKEND_URL?.trim()) {
  throw new Error('Remove REACT_APP_BACKEND_URL on Vercel: API requests must use the same-origin proxy for session cookies.');
}

export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'build',
  rewrites: [
    { source: '/api', destination: `${backend.origin}/api` },
    { source: '/api/:path*', destination: `${backend.origin}/api/:path*` },
    { source: '/((?!api(?:/|$)).*)', destination: '/index.html' },
  ],
  headers: [
    { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    { source: '/service-worker.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=(), payment=()' },
    ] },
  ],
};
