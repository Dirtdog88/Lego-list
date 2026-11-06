// Cloudflare Turnstile: the free "are you a person" check on the two public doors that change data
// (claim a wishlist set, add a set someone bought). Fails closed: no secret means no claims.

const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Local preview only: both switches must be set, and neither is ever in wrangler.toml.
export function turnstileBypassed(env) {
  return env.TURNSTILE_BYPASS === 'yes-local-only' && env.DEV_BYPASS === 'yes-local-only';
}

// Returns null when the token is good, otherwise { status, error }.
export async function checkTurnstile(token, request, env, fetchImpl = fetch) {
  if (turnstileBypassed(env)) return null;
  if (!env.TURNSTILE_SECRET) return { status: 503, error: "Claiming isn't switched on yet." };
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { status: 403, error: 'Please finish the check above the button first.' };
  }
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchImpl(VERIFY, { method: 'POST', body });
    const out = res.ok ? await res.json() : null;
    if (out?.success === true) return null;
  } catch {
    // fall through to the refusal
  }
  return { status: 403, error: "The check didn't go through. Close this and try again." };
}
