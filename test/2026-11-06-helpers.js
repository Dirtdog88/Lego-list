// Shared test and preview helpers: a fake ASSETS binding over public/, a fake network, and requests.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, normalize, extname } from 'node:path';
import { fakeD1 } from './2026-11-06-fake-d1.js';
import { topThemes, catalogRows, catalogSql } from '../scripts/2026-11-06-catalog-rules.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json',
};

export const fakeAssets = {
  async fetch(request) {
    const path = normalize(decodeURIComponent(new URL(request.url).pathname));
    if (path.includes('..')) return new Response('not found', { status: 404 });
    try {
      const body = await readFile(join(PUBLIC, path));
      return new Response(body, { headers: { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  },
};

// The sets in the test catalog (shaped like Rebrickable's sets.csv rows). Theme 158 (Star Wars) is the parent of 171 (UCS).
export const RB_SETS = {
  '75192-1': { set_num: '75192-1', name: 'Millennium Falcon', year: 2017, num_parts: 7541, theme_id: 171, set_img_url: 'https://cdn.rebrickable.com/media/sets/75192-1/1.jpg' },
  '42143-1': { set_num: '42143-1', name: 'Ferrari Daytona SP3', year: 2022, num_parts: 3778, theme_id: 1, set_img_url: 'https://cdn.rebrickable.com/media/sets/42143-1/1.jpg' },
  '60337-1': { set_num: '60337-1', name: 'Express Passenger Train', year: 2022, num_parts: 764, theme_id: 52, set_img_url: 'https://evil.example/x.png' },
  '10305-1': { set_num: '10305-1', name: "Lion Knights' Castle", year: 2022, num_parts: 4514, theme_id: 186, set_img_url: 'https://cdn.rebrickable.com/media/sets/10305-1/1.jpg' },
};
export const RB_THEMES = {
  158: { name: 'Star Wars', parent_id: null },
  171: { name: 'Ultimate Collector Series', parent_id: 158 },
  1: { name: 'Technic', parent_id: null },
  52: { name: 'City', parent_id: null },
  186: { name: 'Icons', parent_id: null },
};

// A fake network: Turnstile ("good" tokens pass) and nothing else.
export function fakeNet() {
  const calls = [];
  const fn = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const token = new URLSearchParams(String(init.body)).get('response');
      return reply({ success: token === 'good' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  fn.calls = calls;
  return fn;
}

// Loads RB_SETS into the catalog table the same way `npm run catalog` does.
export function loadCatalog(db) {
  const themes = topThemes(Object.entries(RB_THEMES).map(([id, t]) => ({ id, name: t.name, parent_id: t.parent_id ?? '' })));
  const rows = catalogRows(Object.values(RB_SETS).map((s) => ({ ...s, img_url: s.set_img_url })), themes);
  db.raw.exec(catalogSql(rows));
}

export function makeEnv(extra = {}, { catalog = true } = {}) {
  const DB = fakeD1();
  if (catalog) loadCatalog(DB);
  return {
    DB,
    ASSETS: fakeAssets,
    TURNSTILE_SECRET: 'ts-test',
    TURNSTILE_SITE_KEY: 'site-test',
    ADMIN_EMAILS: 'admin@example.com',
    ACCESS_TEAM_DOMAIN: 'team.example.com',
    ACCESS_AUD: 'aud',
    ...extra,
  };
}

export const ORIGIN = 'https://lego.dirtdogcollective.com';

export function req(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  return new Request(ORIGIN + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function insertSet(env, { set_num, name = set_num, status, theme = '' }) {
  const r = await env.DB.prepare(
    "INSERT INTO sets (set_num, name, theme, status, added_at) VALUES (?, ?, ?, ?, '2026-11-01T00:00:00Z') RETURNING id",
  ).bind(set_num, name, theme, status).first();
  return r.id;
}
