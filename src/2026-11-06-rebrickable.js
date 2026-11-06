// Looks a set up in the `catalog` table: a copy of Rebrickable's free catalog downloads, loaded by
// `npm run catalog` (scripts/2026-11-06-catalog.js). Since 2026-11-06 there is no call to
// Rebrickable's API: its bot protection turns away requests from Cloudflare's servers.

const IMAGE_HOST = 'https://cdn.rebrickable.com/';

export class LookupError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// "75192" -> "75192-1"; "75192-1" stays. Returns null for anything that isn't a set number.
export function normalizeSetNum(input) {
  let s = String(input ?? '').trim().toLowerCase().replace(/^#/, '');
  if (/^\d{3,8}$/.test(s)) s += '-1';
  return /^[0-9a-z]{1,20}-\d{1,3}$/.test(s) ? s : null;
}

// Only Rebrickable's own image host, so a bad row can't put an arbitrary picture on the page.
export function safeImage(url) {
  return typeof url === 'string' && url.startsWith(IMAGE_HOST) && url.length <= 500 ? url : '';
}

const NOT_LOADED = "Set lookup isn't loaded yet. Run npm run catalog.";

// Returns the set's details, or null when the catalog doesn't have the number.
// (fetchImpl is unused, kept so callers don't change.)
export async function lookupSet(setNum, env, _fetchImpl) {
  let row;
  try {
    row = await env.DB.prepare('SELECT set_num, name, theme, year, pieces, image_url FROM catalog WHERE set_num = ?')
      .bind(setNum).first();
    if (!row && !(await env.DB.prepare('SELECT 1 AS one FROM catalog LIMIT 1').first())) {
      throw new LookupError(NOT_LOADED, 503);
    }
  } catch (err) {
    if (/no such table/i.test(String(err?.message))) throw new LookupError(NOT_LOADED, 503);
    throw err;
  }
  if (!row) return null;
  return {
    set_num: row.set_num,
    name: String(row.name).slice(0, 200),
    year: Number.isInteger(row.year) ? row.year : null,
    pieces: Number.isInteger(row.pieces) ? row.pieces : null,
    image_url: safeImage(row.image_url),
    theme: String(row.theme ?? '').slice(0, 100),
  };
}
