// Looks a set up on Rebrickable (name, year, pieces, picture, theme). The API key stays on the
// server (secret REBRICKABLE_KEY), so the browser never sees it.

const API = 'https://rebrickable.com/api/v3/lego';
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

// Only Rebrickable's own image host, so a bad answer can't put an arbitrary picture on the page.
export function safeImage(url) {
  return typeof url === 'string' && url.startsWith(IMAGE_HOST) && url.length <= 500 ? url : '';
}

const themeCache = new Map(); // id -> { name, parent_id }

export function resetThemeCache() {
  themeCache.clear();
}

async function theme(id, headers, fetchImpl) {
  if (themeCache.has(id)) return themeCache.get(id);
  const res = await fetchImpl(`${API}/themes/${id}/`, { headers });
  if (!res.ok) return null;
  const t = await res.json();
  const out = { name: String(t.name ?? ''), parent_id: Number.isInteger(t.parent_id) ? t.parent_id : null };
  themeCache.set(id, out);
  return out;
}

// The top-level theme ("Star Wars", not "Ultimate Collector Series"), so the filter stays short.
async function topTheme(id, headers, fetchImpl) {
  let name = '';
  for (let i = 0; i < 4 && Number.isInteger(id); i++) {
    const t = await theme(id, headers, fetchImpl);
    if (!t) break;
    name = t.name;
    id = t.parent_id;
  }
  return name.slice(0, 100);
}

// Returns the set's details, or null when Rebrickable doesn't know the number.
export async function lookupSet(setNum, env, fetchImpl = fetch) {
  if (!env.REBRICKABLE_KEY) throw new LookupError('Set lookup is not switched on yet (no Rebrickable key).', 503);
  const headers = {
    Authorization: `key ${String(env.REBRICKABLE_KEY).trim()}`,
    Accept: 'application/json',
    'User-Agent': 'lego-list (https://lego.dirtdogcollective.com)',
  };
  const res = await fetchImpl(`${API}/sets/${encodeURIComponent(setNum)}/`, { headers });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    console.error('Rebrickable refused the request', res.status, (await res.text()).slice(0, 200));
    throw new LookupError(`Rebrickable refused the API key (${res.status}). Check the REBRICKABLE_KEY secret.`, 502);
  }
  if (!res.ok) throw new LookupError(`Rebrickable answered ${res.status}. Try again in a minute.`, 502);
  const s = await res.json();
  const num = normalizeSetNum(s.set_num) ?? setNum;
  return {
    set_num: num,
    name: String(s.name ?? num).slice(0, 200),
    year: Number.isInteger(s.year) ? s.year : null,
    pieces: Number.isInteger(s.num_parts) ? s.num_parts : null,
    image_url: safeImage(s.set_img_url),
    theme: Number.isInteger(s.theme_id) ? await topTheme(s.theme_id, headers, fetchImpl) : '',
  };
}
