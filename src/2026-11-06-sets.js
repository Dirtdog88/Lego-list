// The sets: public reading and claiming, and the admin changes.
// Nothing here stores or returns who claimed a set (there is nowhere to put it).

import { lookupSet, normalizeSetNum, LookupError } from './2026-11-06-rebrickable.js';
import { checkTurnstile } from './2026-11-06-turnstile.js';

export const STATUSES = ['owned', 'wishlist', 'claimed'];
const TRASH_DAYS = 30;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const now = () => new Date().toISOString();

// What anyone can see: no dates, so a claim date can't hint at who or when.
const PUBLIC_COLS = 'id, set_num, name, theme, year, pieces, image_url, status';
const ADMIN_COLS = `${PUBLIC_COLS}, added_at, claimed_at, received_at, deleted_at`;

async function liveBySetNum(db, setNum) {
  return db.prepare(`SELECT ${ADMIN_COLS} FROM sets WHERE set_num = ? AND deleted_at IS NULL`).bind(setNum).first();
}

async function byId(db, id) {
  return db.prepare(`SELECT ${ADMIN_COLS} FROM sets WHERE id = ?`).bind(id).first();
}

function publicView(row) {
  const { id, set_num, name, theme, year, pieces, image_url, status } = row;
  return { id, set_num, name, theme, year, pieces, image_url, status };
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const isUniqueError = (err) => /UNIQUE/i.test(String(err?.message));

// ---------- public ----------

export async function listPublic(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLS} FROM sets WHERE deleted_at IS NULL ORDER BY theme COLLATE NOCASE, name COLLATE NOCASE`,
  ).all();
  return json({ sets: results, turnstile_site_key: env.TURNSTILE_SITE_KEY ?? '' });
}

// "I'm getting this" on a wishlist set.
export async function claim(request, env, fetchImpl) {
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Which set?' }, 400);
  const refused = await checkTurnstile(body.token, request, env, fetchImpl);
  if (refused) return json({ error: refused.error }, refused.status);
  const r = await env.DB.prepare(
    "UPDATE sets SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'wishlist' AND deleted_at IS NULL",
  ).bind(now(), id).run();
  if (r.meta.changes === 1) return json({ set: publicView(await byId(env.DB, id)) });
  const row = await byId(env.DB, id);
  if (!row || row.deleted_at) return json({ error: "That set isn't on the list any more." }, 404);
  return json(alreadyMessage(row), 409);
}

function alreadyMessage(row) {
  if (row.status === 'owned') return { error: 'He already has this one!', set: publicView(row) };
  return { error: "Someone's already getting this one.", set: publicView(row) };
}

// "I bought something that isn't on the list": adds it as claimed so nobody else buys it.
export async function bought(request, env, fetchImpl) {
  const body = await readJson(request);
  const setNum = normalizeSetNum(body?.set_num);
  if (!setNum) return json({ error: 'That doesn\'t look like a set number. It\'s on the box, like 75192.' }, 400);
  const refused = await checkTurnstile(body.token, request, env, fetchImpl);
  if (refused) return json({ error: refused.error }, refused.status);

  const existing = await liveBySetNum(env.DB, setNum);
  if (existing) {
    if (existing.status !== 'wishlist') return json(alreadyMessage(existing), 409);
    const r = await env.DB.prepare(
      "UPDATE sets SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'wishlist' AND deleted_at IS NULL",
    ).bind(now(), existing.id).run();
    if (r.meta.changes !== 1) return json(alreadyMessage(await byId(env.DB, existing.id)), 409);
    return json({ set: publicView(await byId(env.DB, existing.id)) });
  }

  let info;
  try {
    info = await lookupSet(setNum, env, fetchImpl);
  } catch (err) {
    if (err instanceof LookupError) return json({ error: err.message }, err.status);
    throw err;
  }
  if (!info) return json({ error: `Couldn't find set ${setNum}. Check the number on the box.` }, 404);
  const again = await liveBySetNum(env.DB, info.set_num);
  if (again) return json(alreadyMessage(again), 409);
  try {
    const t = now();
    const r = await env.DB.prepare(
      `INSERT INTO sets (set_num, name, theme, year, pieces, image_url, status, added_at, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'claimed', ?, ?) RETURNING id`,
    ).bind(info.set_num, info.name, info.theme, info.year, info.pieces, info.image_url, t, t).first();
    return json({ set: publicView(await byId(env.DB, r.id)) }, 201);
  } catch (err) {
    if (isUniqueError(err)) return json(alreadyMessage(await liveBySetNum(env.DB, info.set_num)), 409);
    throw err;
  }
}

// ---------- admin (behind Cloudflare Access) ----------

export async function listAdmin(env) {
  const since = new Date(Date.now() - TRASH_DAYS * 86400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT ${ADMIN_COLS} FROM sets WHERE deleted_at IS NULL OR deleted_at >= ?
     ORDER BY theme COLLATE NOCASE, name COLLATE NOCASE`,
  ).bind(since).all();
  return json({ sets: results });
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Changes a row's status, keeping the dates right. Returns the SQL statement.
function moveTo(db, row, status) {
  const t = now();
  const claimed_at = status === 'claimed' ? (row.status === 'claimed' ? row.claimed_at : t) : status === 'owned' ? row.claimed_at : null;
  const received_at = status === 'owned' ? (row.status === 'owned' ? row.received_at : t) : null;
  return db.prepare('UPDATE sets SET status = ?, claimed_at = ?, received_at = ? WHERE id = ?')
    .bind(status, claimed_at, received_at, row.id);
}

// Add one set as owned or wishlist. If it's already on the list, it moves to that status
// (e.g. a wishlist set he got: add it as owned). Name and theme are only used when Rebrickable
// doesn't know the number.
export async function adminAdd(request, env, fetchImpl) {
  const body = await readJson(request);
  const setNum = normalizeSetNum(body?.set_num);
  if (!setNum) return json({ error: 'Not a set number.' }, 400);
  const status = body.status;
  if (!STATUSES.includes(status)) return json({ error: 'status must be owned, wishlist or claimed' }, 400);

  const existing = await liveBySetNum(env.DB, setNum);
  if (existing) {
    if (existing.status !== status) await moveTo(env.DB, existing, status).run();
    return json({ set: await byId(env.DB, existing.id), result: existing.status === status ? 'already' : 'moved' });
  }

  let info = null;
  try {
    info = await lookupSet(setNum, env, fetchImpl);
  } catch (err) {
    if (!(err instanceof LookupError)) throw err;
    if (!text(body.name, 200)) return json({ error: err.message }, err.status);
  }
  if (!info) {
    const name = text(body.name, 200);
    if (!name) return json({ error: `Rebrickable doesn't know ${setNum}. Add a name to add it by hand.` }, 404);
    info = { set_num: setNum, name, theme: text(body.theme, 100), year: null, pieces: null, image_url: '' };
  }
  const again = await liveBySetNum(env.DB, info.set_num);
  if (again) {
    if (again.status !== status) await moveTo(env.DB, again, status).run();
    return json({ set: await byId(env.DB, again.id), result: again.status === status ? 'already' : 'moved' });
  }
  const t = now();
  const r = await env.DB.prepare(
    `INSERT INTO sets (set_num, name, theme, year, pieces, image_url, status, added_at, claimed_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    info.set_num, info.name, info.theme, info.year, info.pieces, info.image_url, status, t,
    status === 'claimed' ? t : null, null,
  ).first();
  return json({ set: await byId(env.DB, r.id), result: 'added' }, 201);
}

// { status } moves it; { remove: true } puts it in the trash; { restore: true } brings it back.
export async function adminUpdate(request, env, id) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Send a JSON body.' }, 400);
  const row = await byId(env.DB, id);
  if (!row) return json({ error: 'No such set.' }, 404);

  if (body.remove === true) {
    if (!row.deleted_at) await env.DB.prepare('UPDATE sets SET deleted_at = ? WHERE id = ?').bind(now(), id).run();
  } else if (body.restore === true) {
    if (row.deleted_at) {
      try {
        await env.DB.prepare('UPDATE sets SET deleted_at = NULL WHERE id = ?').bind(id).run();
      } catch (err) {
        if (isUniqueError(err)) return json({ error: `${row.set_num} is already on the list again.` }, 409);
        throw err;
      }
    }
  } else if (STATUSES.includes(body.status)) {
    if (row.deleted_at) return json({ error: 'Restore it first.' }, 409);
    if (row.status !== body.status) await moveTo(env.DB, row, body.status).run();
  } else {
    return json({ error: 'Send status, remove or restore.' }, 400);
  }
  return json({ set: await byId(env.DB, id) });
}

// Lookup only, so the admin page can show what a number is before adding it.
export async function adminLookup(request, env, fetchImpl) {
  const body = await readJson(request);
  const setNum = normalizeSetNum(body?.set_num);
  if (!setNum) return json({ error: 'Not a set number.' }, 400);
  try {
    const info = await lookupSet(setNum, env, fetchImpl);
    return info ? json({ set: info }) : json({ error: `Rebrickable doesn't know ${setNum}.` }, 404);
  } catch (err) {
    if (err instanceof LookupError) return json({ error: err.message }, err.status);
    throw err;
  }
}
