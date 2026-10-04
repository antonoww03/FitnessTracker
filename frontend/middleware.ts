import { ipAddress, next } from '@vercel/functions';
import { upstreamHeaders } from './server/proxy-identity.mjs';

export const config = { runtime: 'nodejs', matcher: '/api/auth/:path*' };

export default function middleware(request: Request) {
  try {
    const headers = upstreamHeaders(request, ipAddress(request), process.env.FITTRACK_PROXY_IDENTITY_KEY);
    // Request overrides only: the signature must never become a response header.
    return next({ request: { headers } });
  } catch {
    return Response.json({ detail: 'Authentication is temporarily unavailable. Try again shortly.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '30' },
    });
  }
}
