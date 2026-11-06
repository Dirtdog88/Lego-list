// Best-effort rate limit for the two public doors that change data (POST /api/claim, /api/bought),
// adapted from DogHouse. Counts live in memory, per Worker instance and caller IP, for a minute.
// Cloudflare runs many instances, so this only slows a flood down; Turnstile is the real lock.

const WINDOW_MS = 60_000;
const MAX = 10;
const MAX_KEYS = 2000;
const hits = new Map(); // ip -> { start, count }

export function rateLimited(request, now = Date.now()) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  let entry = hits.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    if (hits.size >= MAX_KEYS) {
      for (const [k, e] of hits) if (now - e.start >= WINDOW_MS) hits.delete(k);
      if (hits.size >= MAX_KEYS) hits.clear();
    }
    entry = { start: now, count: 0 };
    hits.set(ip, entry);
  }
  entry.count++;
  if (entry.count <= MAX) return null;
  const wait = Math.max(Math.ceil((entry.start + WINDOW_MS - now) / 1000), 1);
  return new Response(JSON.stringify({ error: 'Too many tries. Wait a minute and try again.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(wait), 'Cache-Control': 'no-store' },
  });
}

export function resetRateLimits() {
  hits.clear();
}
