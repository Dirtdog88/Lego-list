// Lego list worker: the public page and its API, plus /admin behind Cloudflare Access.
//
//   GET  /api/sets           anyone: the list (no dates, no buyers: there are none)
//   POST /api/claim          anyone, with Turnstile: "I'm getting this" on a wishlist set
//   POST /api/bought         anyone, with Turnstile: a set not on the list, added as claimed
//   /admin, /admin/api/*     only ADMIN_EMAILS, checked here as well as by Access at the edge

import { checkAccess } from './2026-11-06-access.js';
import { rateLimited } from './2026-11-06-ratelimit.js';
import { json, listPublic, claim, bought, listAdmin, adminAdd, adminUpdate, adminLookup } from './2026-11-06-sets.js';

const PUBLIC_PAGE = '/2026-11-06-lego.html';
const ADMIN_PAGE = '/admin/2026-11-06-admin.html';
const TURNSTILE = 'https://challenges.cloudflare.com';

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  // Public, but kept out of search engines (a child's things).
  'X-Robots-Tag': 'noindex, nofollow',
};

const csp = (admin) =>
  [
    "default-src 'self'",
    admin ? "script-src 'self'" : `script-src 'self' ${TURNSTILE}`,
    admin ? "frame-src 'none'" : `frame-src ${TURNSTILE}`,
    "style-src 'self'",
    "img-src 'self' https://cdn.rebrickable.com",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

function withHeaders(res, admin) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(BASE_HEADERS)) out.headers.set(k, v);
  out.headers.set('Content-Security-Policy', csp(admin));
  return out;
}

async function asset(request, env, url, admin) {
  let path = url.pathname;
  if (path === '/') path = PUBLIC_PAGE;
  if (path === '/admin' || path === '/admin/') path = ADMIN_PAGE;
  const res = await env.ASSETS.fetch(new Request(new URL(path, url), request));
  const out = withHeaders(res, admin);
  if (path.endsWith('.html')) out.headers.set('Cache-Control', 'no-cache');
  return out;
}

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function signedOut(url, reason) {
  if (url.pathname.startsWith('/admin/api/')) return withHeaders(json({ error: 'signed_out', reason }, 401), true);
  return withHeaders(
    new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not signed in</title><h1>Not signed in.</h1><p>${escapeHtml(reason)}</p><p><a href="/">Back to the list</a></p></html>`,
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    ),
    true,
  );
}

// Changes only come from this site's own pages, and only as JSON (which a plain form on another
// site can't send). Returns the refusal, or null when the request is fine.
export function refuseCrossSite(request, url) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'cross-site request refused' }, 403);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'cross-site request refused' }, 403);
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return json({ error: 'send JSON' }, 415);
  return null;
}

async function publicApi(request, env, url, fetchImpl) {
  const { pathname: path } = url;
  const { method } = request;
  if (path === '/api/sets' && (method === 'GET' || method === 'HEAD')) return listPublic(env);
  if ((path === '/api/claim' || path === '/api/bought') && method === 'POST') {
    const refused = refuseCrossSite(request, url) ?? rateLimited(request);
    if (refused) return refused;
    return path === '/api/claim' ? claim(request, env, fetchImpl) : bought(request, env, fetchImpl);
  }
  return json({ error: 'not found' }, 404);
}

async function adminApi(request, env, url, fetchImpl) {
  const { pathname: path } = url;
  const { method } = request;
  if (method !== 'GET' && method !== 'HEAD') {
    const refused = refuseCrossSite(request, url);
    if (refused) return refused;
  }
  if (path === '/admin/api/sets' && method === 'GET') return listAdmin(env);
  if (path === '/admin/api/sets' && method === 'POST') return adminAdd(request, env, fetchImpl);
  if (path === '/admin/api/lookup' && method === 'POST') return adminLookup(request, env, fetchImpl);
  const m = path.match(/^\/admin\/api\/sets\/(\d{1,10})$/);
  if (m && method === 'POST') return adminUpdate(request, env, Number(m[1]));
  return json({ error: 'not found' }, 404);
}

// deps.fetch stands in for the network in tests and the local preview.
export async function handle(request, env, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const url = new URL(request.url);
  try {
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const who = await checkAccess(request, env, fetchImpl);
      if (!who.email) return signedOut(url, who.reason);
      if (url.pathname.startsWith('/admin/api/')) return withHeaders(await adminApi(request, env, url, fetchImpl), true);
      return asset(request, env, url, true);
    }
    if (url.pathname.startsWith('/api/')) return withHeaders(await publicApi(request, env, url, fetchImpl), false);
    return asset(request, env, url, false);
  } catch (err) {
    console.error('lego-list error', err);
    return withHeaders(json({ error: 'Something went wrong. Try again in a minute.' }, 500), false);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
