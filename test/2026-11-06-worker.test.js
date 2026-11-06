import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/2026-11-06-index.js';
import { resetRateLimits } from '../src/2026-11-06-ratelimit.js';
import { resetThemeCache, normalizeSetNum, safeImage } from '../src/2026-11-06-rebrickable.js';
import { makeEnv, fakeNet, req, insertSet } from './2026-11-06-helpers.js';

const DEV = { DEV_BYPASS: 'yes-local-only', DEV_BYPASS_EMAIL: 'admin@example.com' };

beforeEach(() => {
  resetRateLimits();
  resetThemeCache();
});

async function call(env, path, opts, net = fakeNet()) {
  const res = await handle(req(path, opts), env, { fetch: net });
  const type = res.headers.get('Content-Type') ?? '';
  return { res, status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}

// ---------- set numbers and images ----------

test('set numbers: bare numbers get -1, junk is refused', () => {
  assert.equal(normalizeSetNum('75192'), '75192-1');
  assert.equal(normalizeSetNum(' #75192-2 '), '75192-2');
  assert.equal(normalizeSetNum('COL24-1'), 'col24-1');
  assert.equal(normalizeSetNum('75'), null);
  assert.equal(normalizeSetNum('../x'), null);
  assert.equal(normalizeSetNum('75192/1'), null);
  assert.equal(normalizeSetNum(null), null);
});

test('only Rebrickable images are kept', () => {
  assert.equal(safeImage('https://cdn.rebrickable.com/media/sets/1.jpg'), 'https://cdn.rebrickable.com/media/sets/1.jpg');
  assert.equal(safeImage('https://cdn.rebrickable.com.evil.example/x.jpg'), '');
  assert.equal(safeImage('javascript:alert(1)'), '');
  assert.equal(safeImage(null), '');
});

// ---------- the public list ----------

test('public list: live sets only, no dates, plus the Turnstile site key', async () => {
  const env = makeEnv();
  await insertSet(env, { set_num: '1-1', status: 'owned' });
  const gone = await insertSet(env, { set_num: '2-1', status: 'wishlist' });
  await env.DB.prepare("UPDATE sets SET deleted_at = '2026-11-02' WHERE id = ?").bind(gone).run();
  const { status, data, res } = await call(env, '/api/sets');
  assert.equal(status, 200);
  assert.equal(data.turnstile_site_key, 'site-test');
  assert.deepEqual(data.sets.map((s) => s.set_num), ['1-1']);
  assert.equal('claimed_at' in data.sets[0], false);
  assert.equal('added_at' in data.sets[0], false);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

// ---------- claiming ----------

test('claim: a wishlist set with a good check becomes claimed, and only once', async () => {
  const env = makeEnv();
  const id = await insertSet(env, { set_num: '75192-1', status: 'wishlist' });
  const first = await call(env, '/api/claim', { method: 'POST', body: { id, token: 'good' } });
  assert.equal(first.status, 200);
  assert.equal(first.data.set.status, 'claimed');
  const row = await env.DB.prepare('SELECT * FROM sets WHERE id = ?').bind(id).first();
  assert.ok(row.claimed_at);
  const second = await call(env, '/api/claim', { method: 'POST', body: { id, token: 'good' } });
  assert.equal(second.status, 409);
  assert.match(second.data.error, /already getting/);
});

test('claim: refused without a token, with a bad one, or with no secret set', async () => {
  const env = makeEnv();
  const id = await insertSet(env, { set_num: '75192-1', status: 'wishlist' });
  assert.equal((await call(env, '/api/claim', { method: 'POST', body: { id } })).status, 403);
  assert.equal((await call(env, '/api/claim', { method: 'POST', body: { id, token: 'bad' } })).status, 403);
  const off = makeEnv({ TURNSTILE_SECRET: '' });
  const id2 = await insertSet(off, { set_num: '75192-1', status: 'wishlist' });
  assert.equal((await call(off, '/api/claim', { method: 'POST', body: { id: id2, token: 'good' } })).status, 503);
  const row = await env.DB.prepare('SELECT status FROM sets WHERE id = ?').bind(id).first();
  assert.equal(row.status, 'wishlist');
});

test('claim: an owned or removed set cannot be claimed', async () => {
  const env = makeEnv();
  const owned = await insertSet(env, { set_num: '1-1', status: 'owned' });
  const r = await call(env, '/api/claim', { method: 'POST', body: { id: owned, token: 'good' } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /already has/);
  const gone = await insertSet(env, { set_num: '2-1', status: 'wishlist' });
  await env.DB.prepare("UPDATE sets SET deleted_at = '2026-11-02' WHERE id = ?").bind(gone).run();
  assert.equal((await call(env, '/api/claim', { method: 'POST', body: { id: gone, token: 'good' } })).status, 404);
  assert.equal((await call(env, '/api/claim', { method: 'POST', body: { id: 999, token: 'good' } })).status, 404);
});

test('the local-preview Turnstile bypass needs both switches', async () => {
  const half = makeEnv({ TURNSTILE_BYPASS: 'yes-local-only' });
  const id = await insertSet(half, { set_num: '1-1', status: 'wishlist' });
  assert.equal((await call(half, '/api/claim', { method: 'POST', body: { id, token: 'x' } })).status, 403);
  const both = makeEnv({ TURNSTILE_BYPASS: 'yes-local-only', DEV_BYPASS: 'yes-local-only' });
  const id2 = await insertSet(both, { set_num: '1-1', status: 'wishlist' });
  assert.equal((await call(both, '/api/claim', { method: 'POST', body: { id: id2, token: 'x' } })).status, 200);
});

// ---------- bought something not on the list ----------

test('bought: a new set is looked up and added as claimed, with its top-level theme', async () => {
  const env = makeEnv();
  const r = await call(env, '/api/bought', { method: 'POST', body: { set_num: '75192', token: 'good' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.set.name, 'Millennium Falcon');
  assert.equal(r.data.set.status, 'claimed');
  assert.equal(r.data.set.theme, 'Star Wars');
  assert.equal(r.data.set.pieces, 7541);
  const again = await call(env, '/api/bought', { method: 'POST', body: { set_num: '75192-1', token: 'good' } });
  assert.equal(again.status, 409);
});

test('bought: owned is refused, wishlist gets claimed, unknown is 404, odd images are dropped', async () => {
  const env = makeEnv();
  await insertSet(env, { set_num: '42143-1', status: 'owned' });
  const wish = await insertSet(env, { set_num: '10305-1', status: 'wishlist' });
  const owned = await call(env, '/api/bought', { method: 'POST', body: { set_num: '42143', token: 'good' } });
  assert.equal(owned.status, 409);
  assert.match(owned.data.error, /already has/);
  const w = await call(env, '/api/bought', { method: 'POST', body: { set_num: '10305', token: 'good' } });
  assert.equal(w.status, 200);
  assert.equal(w.data.set.id, wish);
  assert.equal(w.data.set.status, 'claimed');
  assert.equal((await call(env, '/api/bought', { method: 'POST', body: { set_num: '99999', token: 'good' } })).status, 404);
  const odd = await call(env, '/api/bought', { method: 'POST', body: { set_num: '60337', token: 'good' } });
  assert.equal(odd.data.set.image_url, '');
  assert.equal((await call(env, '/api/bought', { method: 'POST', body: { set_num: 'nope!', token: 'good' } })).status, 400);
});

test('bought: no Turnstile, no lookup', async () => {
  const env = makeEnv();
  const net = fakeNet();
  const r = await call(env, '/api/bought', { method: 'POST', body: { set_num: '75192', token: 'bad' } }, net);
  assert.equal(r.status, 403);
  assert.equal(net.calls.some((c) => c.url.includes('rebrickable')), false);
});

test('bought: no Rebrickable key means a clear 503', async () => {
  const env = makeEnv({ REBRICKABLE_KEY: '' });
  const r = await call(env, '/api/bought', { method: 'POST', body: { set_num: '75192', token: 'good' } });
  assert.equal(r.status, 503);
});

// ---------- doors ----------

test('changes must be same-site JSON', async () => {
  const env = makeEnv();
  const id = await insertSet(env, { set_num: '1-1', status: 'wishlist' });
  const body = { id, token: 'good' };
  assert.equal((await call(env, '/api/claim', { method: 'POST', body, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call(env, '/api/claim', { method: 'POST', body, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(env, '/api/claim', { method: 'POST', body: `id=${id}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await call(env, '/api/claim', { method: 'POST', body, headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://lego.dirtdogcollective.com' } })).status, 200);
});

test('claims are rate limited per IP', async () => {
  const env = makeEnv();
  const headers = { 'CF-Connecting-IP': '203.0.113.9' };
  for (let i = 0; i < 10; i++) {
    const r = await call(env, '/api/claim', { method: 'POST', body: { id: 999, token: 'good' }, headers });
    assert.equal(r.status, 404);
  }
  const r = await call(env, '/api/claim', { method: 'POST', body: { id: 999, token: 'good' }, headers });
  assert.equal(r.status, 429);
  const other = await call(env, '/api/claim', { method: 'POST', body: { id: 999, token: 'good' }, headers: { 'CF-Connecting-IP': '203.0.113.10' } });
  assert.equal(other.status, 404);
});

test('unknown API paths and methods are 404', async () => {
  const env = makeEnv();
  assert.equal((await call(env, '/api/nope')).status, 404);
  assert.equal((await call(env, '/api/claim')).status, 404);
  assert.equal((await call(env, '/api/sets', { method: 'POST', body: {} })).status, 404);
});

// ---------- pages ----------

test('the public page has the security headers and allows only Turnstile and Rebrickable', async () => {
  const env = makeEnv();
  const { res, status, data } = await call(env, '/');
  assert.equal(status, 200);
  assert.match(data, /Our Lego list/);
  const csp = res.headers.get('Content-Security-Policy');
  assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /img-src 'self' https:\/\/cdn\.rebrickable\.com/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
  assert.equal((await call(env, '/robots.txt')).status, 200);
});

// ---------- admin ----------

test('admin needs a login: page and API both 401 without one', async () => {
  const env = makeEnv();
  for (const path of ['/admin', '/admin/', '/admin/2026-11-06-admin.js', '/admin/api/sets']) {
    const r = await call(env, path);
    assert.equal(r.status, 401, path);
  }
  const post = await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '75192', status: 'owned' } });
  assert.equal(post.status, 401);
  const noAdmins = makeEnv({ ...DEV, ADMIN_EMAILS: '' });
  assert.equal((await call(noAdmins, '/admin/api/sets')).status, 401);
  const wrong = makeEnv({ ...DEV, DEV_BYPASS_EMAIL: 'someone@example.com' });
  assert.equal((await call(wrong, '/admin/api/sets')).status, 401);
});

test('admin: add, move, claim dates, remove and restore', async () => {
  const env = makeEnv(DEV);
  const added = await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '75192', status: 'wishlist' } });
  assert.equal(added.status, 201);
  assert.equal(added.data.result, 'added');
  const id = added.data.set.id;

  // Already there: same status says so; another status moves it.
  assert.equal((await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '75192-1', status: 'wishlist' } })).data.result, 'already');

  // Someone claims it, then it arrives.
  await call(env, '/api/claim', { method: 'POST', body: { id, token: 'good' } });
  const got = await call(env, `/admin/api/sets/${id}`, { method: 'POST', body: { status: 'owned' } });
  assert.equal(got.data.set.status, 'owned');
  assert.ok(got.data.set.received_at);
  assert.ok(got.data.set.claimed_at);

  // Undo a claim clears the claim date.
  const id2 = (await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '42143', status: 'wishlist' } })).data.set.id;
  await call(env, '/api/claim', { method: 'POST', body: { id: id2, token: 'good' } });
  const undone = await call(env, `/admin/api/sets/${id2}`, { method: 'POST', body: { status: 'wishlist' } });
  assert.equal(undone.data.set.status, 'wishlist');
  assert.equal(undone.data.set.claimed_at, null);

  // Remove, re-add the same number, then restoring the old one is a conflict.
  const removed = await call(env, `/admin/api/sets/${id}`, { method: 'POST', body: { remove: true } });
  assert.ok(removed.data.set.deleted_at);
  const list = await call(env, '/admin/api/sets');
  assert.equal(list.data.sets.find((s) => s.id === id).deleted_at !== null, true);
  const pub = await call(env, '/api/sets');
  assert.equal(pub.data.sets.some((s) => s.id === id), false);
  await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '75192', status: 'owned' } });
  assert.equal((await call(env, `/admin/api/sets/${id}`, { method: 'POST', body: { restore: true } })).status, 409);
  assert.equal((await call(env, `/admin/api/sets/${id}`, { method: 'POST', body: { status: 'owned' } })).status, 409);
  assert.equal((await call(env, `/admin/api/sets/${id}`, { method: 'POST', body: { status: 'lost' } })).status, 400);
  assert.equal((await call(env, '/admin/api/sets/9999', { method: 'POST', body: { status: 'owned' } })).status, 404);
});

test('admin: unknown sets need a name; with one they are added by hand', async () => {
  const env = makeEnv(DEV);
  const r = await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '99999', status: 'owned' } });
  assert.equal(r.status, 404);
  const byHand = await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '99999', status: 'owned', name: 'Grandpa\'s old castle', theme: 'Castle' } });
  assert.equal(byHand.status, 201);
  assert.equal(byHand.data.set.name, "Grandpa's old castle");
  assert.equal(byHand.data.set.image_url, '');
});

test('admin: lookup previews a set; admin changes are same-site JSON too', async () => {
  const env = makeEnv(DEV);
  const r = await call(env, '/admin/api/lookup', { method: 'POST', body: { set_num: '75192' } });
  assert.equal(r.data.set.theme, 'Star Wars');
  const cross = await call(env, '/admin/api/sets', { method: 'POST', body: { set_num: '75192', status: 'owned' }, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(cross.status, 403);
  const form = await call(env, '/admin/api/sets', { method: 'POST', body: 'set_num=75192', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(form.status, 415);
});

test('nothing anywhere stores a buyer', async () => {
  const env = makeEnv();
  const cols = env.DB.raw.prepare('PRAGMA table_info(sets)').all().map((c) => c.name);
  assert.deepEqual(cols.filter((c) => /buyer|by|who|email|note/i.test(c)), []);
});
