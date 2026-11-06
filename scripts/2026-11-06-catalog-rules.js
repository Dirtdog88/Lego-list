// Pure rules for loading Rebrickable's catalog downloads into the `catalog` table (tested).
import { normalizeSetNum, safeImage } from '../src/2026-11-06-rebrickable.js';

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and new lines. Returns objects keyed by
// the header row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.replace(/^﻿/, '').trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

const int = (v) => (/^\d{1,9}$/.test(String(v ?? '').trim()) ? Number(v) : null);

// themes.csv rows -> Map(id -> top-level theme name), following parent_id up (loops are cut off).
export function topThemes(themeRows) {
  const byId = new Map(themeRows.map((t) => [int(t.id), { name: String(t.name ?? ''), parent: int(t.parent_id) }]));
  const out = new Map();
  for (const id of byId.keys()) {
    let cur = id;
    let name = '';
    for (let i = 0; i < 10 && byId.has(cur); i++) {
      name = byId.get(cur).name;
      cur = byId.get(cur).parent;
    }
    out.set(id, name.slice(0, 100));
  }
  return out;
}

// sets.csv rows -> clean catalog rows. Skips anything that isn't a normal set number.
export function catalogRows(setRows, themes) {
  const out = [];
  const seen = new Set();
  for (const s of setRows) {
    const set_num = normalizeSetNum(s.set_num);
    if (!set_num || set_num !== String(s.set_num).trim().toLowerCase() || seen.has(set_num)) continue;
    const name = String(s.name ?? '').trim().slice(0, 200);
    if (!name) continue;
    seen.add(set_num);
    out.push({
      set_num,
      name,
      theme: themes.get(int(s.theme_id)) ?? '',
      year: int(s.year),
      pieces: int(s.num_parts),
      image_url: safeImage(s.img_url),
    });
  }
  return out;
}

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// SQL for `wrangler d1 execute --file`: upserts in chunks (each statement stays well under D1's
// statement size limit). Upserting, not delete-then-insert, so a lookup never sees an empty table.
export function catalogSql(rows, chunk = 100) {
  const lines = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows.slice(i, i + chunk)
      .map((r) => `(${[r.set_num, r.name, r.theme, r.year, r.pieces, r.image_url].map(lit).join(', ')})`)
      .join(',\n');
    lines.push(`INSERT OR REPLACE INTO catalog (set_num, name, theme, year, pieces, image_url) VALUES\n${values};`);
  }
  return lines.join('\n');
}
