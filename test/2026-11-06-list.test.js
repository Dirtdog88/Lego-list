import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleSets, themesOf, counts, normalizeSetNum, shortNum } from '../public/2026-11-06-list.js';
import { normalizeSetNum as serverNormalize } from '../src/2026-11-06-rebrickable.js';

const SETS = [
  { set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', status: 'claimed' },
  { set_num: '75257-1', name: 'Millennium Falcon (small)', theme: 'Star Wars', status: 'wishlist' },
  { set_num: '42143-1', name: 'Ferrari Daytona SP3', theme: 'Technic', status: 'owned' },
  { set_num: '60337-1', name: 'Express Passenger Train', theme: 'City', status: 'wishlist' },
];

test('wishlist tab: wishlist and claimed, claimed last', () => {
  assert.deepEqual(visibleSets(SETS, { tab: 'wishlist' }).map((s) => s.set_num), ['75257-1', '60337-1', '75192-1']);
});

test('has tab: owned only', () => {
  assert.deepEqual(visibleSets(SETS, { tab: 'owned' }).map((s) => s.set_num), ['42143-1']);
});

test('search matches all words in name, number or theme; theme filters', () => {
  assert.deepEqual(visibleSets(SETS, { tab: 'wishlist', search: 'falcon small' }).map((s) => s.set_num), ['75257-1']);
  assert.deepEqual(visibleSets(SETS, { tab: 'wishlist', search: '60337' }).map((s) => s.set_num), ['60337-1']);
  assert.deepEqual(visibleSets(SETS, { tab: 'wishlist', theme: 'City' }).map((s) => s.set_num), ['60337-1']);
});

test('themes and counts', () => {
  assert.deepEqual(themesOf(SETS), ['City', 'Star Wars', 'Technic']);
  assert.deepEqual(counts(SETS), { owned: 1, wishlist: 2 });
});

test('the page and the server read set numbers the same way', () => {
  for (const s of ['75192', '75192-1', ' #10305 ', 'col24-1', 'abc', '12', '1/2', '']) {
    assert.equal(normalizeSetNum(s), serverNormalize(s), s);
  }
  assert.equal(shortNum('75192-1'), '75192');
  assert.equal(shortNum('75192-2'), '75192-2');
});
