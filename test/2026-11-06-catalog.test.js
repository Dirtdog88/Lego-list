import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, topThemes, catalogRows, catalogSql } from '../scripts/2026-11-06-catalog-rules.js';
import { fakeD1 } from './2026-11-06-fake-d1.js';

test('CSV: quotes, commas, doubled quotes, CRLF and a BOM', () => {
  const rows = parseCsv('﻿set_num,name,year\r\n75192-1,"Falcon, ""UCS""",2017\r\n10305-1,"Two\nlines",2022\n');
  assert.deepEqual(rows, [
    { set_num: '75192-1', name: 'Falcon, "UCS"', year: '2017' },
    { set_num: '10305-1', name: 'Two\nlines', year: '2022' },
  ]);
});

test('themes resolve to the top level, and a loop does not hang', () => {
  const t = topThemes([
    { id: '158', name: 'Star Wars', parent_id: '' },
    { id: '171', name: 'Ultimate Collector Series', parent_id: '158' },
    { id: '9', name: 'Loop A', parent_id: '10' },
    { id: '10', name: 'Loop B', parent_id: '9' },
  ]);
  assert.equal(t.get(171), 'Star Wars');
  assert.equal(t.get(158), 'Star Wars');
  assert.ok(['Loop A', 'Loop B'].includes(t.get(9)));
});

test('catalog rows: clean numbers, top theme, safe images; odd rows skipped', () => {
  const themes = new Map([[171, 'Star Wars']]);
  const rows = catalogRows([
    { set_num: '75192-1', name: 'Millennium Falcon', year: '2017', theme_id: '171', num_parts: '7541', img_url: 'https://cdn.rebrickable.com/media/sets/75192-1.jpg' },
    { set_num: '75192-1', name: 'Duplicate', year: '2017', theme_id: '171', num_parts: '1', img_url: '' },
    { set_num: 'weird set', name: 'Nope', year: '', theme_id: '', num_parts: '', img_url: '' },
    { set_num: '1234', name: 'No suffix', year: '', theme_id: '', num_parts: '', img_url: '' },
    { set_num: '5-1', name: '', year: '', theme_id: '', num_parts: '', img_url: '' },
    { set_num: 'ABC-2', name: 'Upper', year: 'x', theme_id: '999', num_parts: '0', img_url: 'https://evil.example/a.jpg' },
  ], themes);
  assert.deepEqual(rows, [
    { set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, pieces: 7541, image_url: 'https://cdn.rebrickable.com/media/sets/75192-1.jpg' },
    { set_num: 'abc-2', name: 'Upper', theme: '', year: null, pieces: 0, image_url: '' },
  ]);
});

test('the SQL loads into the real table, quotes survive, and a second load replaces rather than duplicates', () => {
  const db = fakeD1();
  const rows = [];
  for (let i = 0; i < 250; i++) rows.push({ set_num: `${1000 + i}-1`, name: `Set ${i}`, theme: 'City', year: 2020, pieces: i, image_url: '' });
  rows.push({ set_num: '10305-1', name: "Lion Knights' Castle; DROP TABLE sets; --", theme: 'Icons', year: null, pieces: null, image_url: '' });
  const sql = catalogSql(rows);
  assert.equal(sql.match(/INSERT OR REPLACE/g).length, 3);
  db.raw.exec(sql);
  db.raw.exec(sql);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM catalog').get().n, 251);
  assert.equal(db.raw.prepare("SELECT name FROM catalog WHERE set_num = '10305-1'").get().name, "Lion Knights' Castle; DROP TABLE sets; --");
  assert.ok(db.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'sets'").get());
});
