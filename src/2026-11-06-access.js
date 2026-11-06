// Checks the Cloudflare Access token on /admin requests (copied from DogHouse, which took it from the
// meal planner). Access already blocks strangers at the edge; this is the second lock, so a
// misconfigured Access policy or a direct hit on the worker still gets nothing. The public page and
// its two claim doors never come here.

const CERT_TTL_MS = 60 * 60 * 1000;
// A token signed with a key we don't have yet (Cloudflare rotated them) fetches the keys again,
// at most once a minute so made-up key ids can't make us hammer Cloudflare.
const REFETCH_MS = 60 * 1000;
let certCache = { url: '', at: 0, keys: [] };
let lastRefetch = 0;

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function signingKeys(teamDomain, fetchImpl, fresh = false) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (!fresh && certCache.url === url && Date.now() - certCache.at < CERT_TTL_MS) return certCache.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const { keys } = await res.json();
  certCache = { url, at: Date.now(), keys };
  return keys;
}

export function resetCertCache() {
  certCache = { url: '', at: 0, keys: [] };
  lastRefetch = 0;
}

export function allowedEmails(env) {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Checks the login and says why it failed, so the signed-out page can explain.
// Returns { email } when allowed, otherwise { email: null, reason }.
// Reasons never include secrets; at most they echo the viewer's own email.
export async function checkAccess(request, env, fetchImpl = fetch) {
  const deny = (reason) => ({ email: null, reason });
  const allowed = allowedEmails(env);
  if (env.DEV_BYPASS_EMAIL && env.DEV_BYPASS === 'yes-local-only') {
    const email = env.DEV_BYPASS_EMAIL.toLowerCase();
    return allowed.includes(email) ? { email } : deny('Local preview email is not in ADMIN_EMAILS.');
  }
  const team = env.ACCESS_TEAM_DOMAIN;
  // One AUD tag per Access application; several (comma-separated) while two addresses are live.
  const appAuds = String(env.ACCESS_AUD ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  if (allowed.length === 0) return deny('The ADMIN_EMAILS secret is missing or empty in Cloudflare.');
  if (!team || appAuds.length === 0) return deny('The app is missing its Cloudflare Access settings (team domain or AUD tag).');

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return deny('No Cloudflare sign-in reached the app. The Access lock is not covering this address.');
  const parts = token.split('.');
  if (parts.length !== 3) return deny('The Cloudflare sign-in token is malformed.');

  let header, payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return deny('The Cloudflare sign-in token is malformed.');
  }
  if (header.alg !== 'RS256') return deny('The Cloudflare sign-in token uses an unexpected format.');

  let jwk = (await signingKeys(team, fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk && Date.now() - lastRefetch >= REFETCH_MS) {
    lastRefetch = Date.now();
    jwk = (await signingKeys(team, fetchImpl, true)).find((k) => k.kid === header.kid);
  }

  if (!jwk) return deny(`The sign-in was not issued by ${team}. Check the team domain.`);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return deny('The Cloudflare sign-in signature did not verify.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return deny('The sign-in has expired. Reload to sign in again.');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return deny('The sign-in is not valid yet. Check the phone clock.');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.some((a) => appAuds.includes(a))) return deny('The sign-in is for a different Access application. Check the AUD tag.');
  if (payload.iss !== `https://${team}`) return deny(`The sign-in was not issued by ${team}. Check the team domain.`);

  const email = String(payload.email ?? '').toLowerCase();
  if (!email) return deny('The sign-in did not include an email address.');
  return allowed.includes(email) ? { email } : deny(`Signed in as ${email}, which is not in ADMIN_EMAILS.`);
}

// Returns the signed-in email, or null. Fails closed when config is missing.
export async function verifyAccess(request, env, fetchImpl = fetch) {
  return (await checkAccess(request, env, fetchImpl)).email;
}
