// `npm run catalog`: downloads Rebrickable's free catalog files (sets and themes, no key needed)
// and loads them into the live database's `catalog` table. Run it on your computer after the first
// deploy, and again now and then (before birthdays and Christmas) to pick up new sets.
// `npm run catalog -- --dry-run` only writes the SQL file and says how many sets it found.
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseCsv, topThemes, catalogRows, catalogSql } from './2026-11-06-catalog-rules.js';

const BASE = 'https://cdn.rebrickable.com/media/downloads/';
const OUT_DIR = '.wrangler';
const OUT = `${OUT_DIR}/2026-11-06-catalog.sql`;

async function download(name) {
  const res = await fetch(BASE + name, { headers: { 'User-Agent': 'lego-list catalog import' } });
  if (!res.ok) throw new Error(`Download of ${name} failed: ${res.status}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
}

console.log('Downloading the Rebrickable catalog…');
const [setsCsv, themesCsv] = await Promise.all([download('sets.csv.gz'), download('themes.csv.gz')]);
const rows = catalogRows(parseCsv(setsCsv), topThemes(parseCsv(themesCsv)));
if (rows.length < 1000) throw new Error(`Only ${rows.length} sets found; the download looks wrong, so nothing was loaded.`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, catalogSql(rows));
console.log(`Found ${rows.length.toLocaleString()} sets. SQL written to ${OUT}.`);
if (process.argv.includes('--dry-run')) process.exit(0);

console.log('Loading it into the lego-list database (about a minute)…');
const run = spawnSync('npx', ['wrangler@4', 'd1', 'execute', 'lego-list', '--remote', `--file=${OUT}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (run.status !== 0) {
  console.error('The load did not finish. Nothing is lost: run npm run catalog again.');
  process.exit(run.status ?? 1);
}
console.log('Done. Set lookups now use this catalog.');
