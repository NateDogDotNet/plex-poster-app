import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedValues, allows, COUNTRY_TABLE, LIMITS, ratingRank } from '../js/ratings.js';

test('the limit choices are the ladder, lowest first', () => {
  assert.deepEqual(LIMITS, ['G', 'PG', 'PG-13', 'R', 'NC-17']);
});

test('ladder rank: G=TV-Y=TV-G < PG=TV-Y7=TV-PG < PG-13=TV-14 < R=TV-MA < NC-17', () => {
  const rungs = [
    ['G', 'TV-Y', 'TV-G'],
    ['PG', 'TV-Y7', 'TV-PG'],
    ['PG-13', 'TV-14'],
    ['R', 'TV-MA'],
    ['NC-17'],
  ];
  rungs.forEach((values, rank) => {
    for (const v of values) assert.equal(ratingRank(v), rank, v);
  });
});

test('every row of the country-prefix table maps onto the US ladder', () => {
  const rows = {
    'gb/': { U: 0, PG: 1, 12: 2, '12A': 2, 15: 3, 18: 4 },
    'de/': { 0: 0, 6: 1, 12: 2, 16: 3, 18: 4 },
    'au/': { G: 0, PG: 1, M: 2, 'MA15+': 3, 'R18+': 4 },
    'ca/': { G: 0, PG: 1, '14A': 2, '18A': 3, R: 4 },
    'fr/': { U: 0, 10: 1, 12: 2, 16: 3, 18: 4 },
    'nl/': { AL: 0, 6: 1, 9: 1, 12: 2, 14: 2, 16: 3, 18: 4 },
  };
  assert.deepEqual(Object.keys(COUNTRY_TABLE).sort(), Object.keys(rows).sort());
  for (const [prefix, table] of Object.entries(rows)) {
    for (const [code, rank] of Object.entries(table)) assert.equal(ratingRank(prefix + code), rank, prefix + code);
  }
});

test('unmapped, empty, missing and non-string values have no rank', () => {
  for (const v of ['gb/XX', 'xx/12', 'gb/', 'gb', '12', 'U', 'NR', 'Not Rated', 'Unrated', 'TV-Z', '', '  ', undefined, null, 12, {}, [], 'constructor', '__proto__', 'toString']) {
    assert.equal(ratingRank(v), null, String(v));
  }
});

test('whitespace and letter case do not hide a rating', () => {
  assert.equal(ratingRank(' pg-13 '), 2);
  assert.equal(ratingRank('GB/12a'), 2);
  assert.equal(ratingRank('tv-ma'), 3);
});

test('limit "" keeps everything, including unrated, missing and unmapped', () => {
  for (const v of ['NC-17', 'R', 'gb/18', 'gb/XX', '', undefined, null, 'whatever']) assert.equal(allows('', v), true, String(v));
  assert.equal(allows(undefined, 'R'), true);
});

test('a limit allows its own rung and below, and nothing above', () => {
  assert.equal(allows('PG-13', 'PG-13'), true);
  assert.equal(allows('PG-13', 'TV-14'), true);
  assert.equal(allows('PG-13', 'PG'), true);
  assert.equal(allows('PG-13', 'R'), false);
  assert.equal(allows('PG-13', 'TV-MA'), false);
  assert.equal(allows('PG-13', 'NC-17'), false);
  assert.equal(allows('R', 'TV-MA'), true, 'the same rung as the limit');
  assert.equal(allows('R', 'gb/15'), true);
  assert.equal(allows('R', 'NC-17'), false);
  assert.equal(allows('NC-17', 'NC-17'), true);
  assert.equal(allows('G', 'TV-Y7'), false);
  assert.equal(allows('G', 'TV-G'), true);
  assert.equal(allows('PG-13', 'gb/12'), true);
  assert.equal(allows('PG-13', 'gb/15'), false);
  assert.equal(allows('PG-13', 'ca/14A'), true);
  assert.equal(allows('PG-13', 'ca/18A'), false);
});

test('while a limit is set, gb/XX, empty, whitespace and missing values are excluded', () => {
  for (const limit of LIMITS) {
    for (const v of ['gb/XX', 'xx/12', '', '  ', undefined, null, 'Not Rated', 'NR', 7]) assert.equal(allows(limit, v), false, `${limit} ${String(v)}`);
  }
});

test('an unknown limit fails closed', () => {
  for (const limit of ['TV-MA', 'pg', 'X', 'constructor', 7]) assert.equal(allows(limit, 'G'), false, String(limit));
});

test('allowedValues is empty for no limit', () => {
  assert.deepEqual(allowedValues(''), []);
  assert.deepEqual(allowedValues(undefined), []);
});

test('allowedValues(PG-13) lists every allowed ladder value and mapped prefixed value, and nothing above', () => {
  const list = allowedValues('PG-13');
  for (const v of ['G', 'PG', 'PG-13', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'gb/U', 'gb/PG', 'gb/12', 'gb/12A', 'de/0', 'de/6', 'de/12', 'fr/U', 'fr/10', 'fr/12', 'au/G', 'au/PG', 'au/M', 'ca/G', 'ca/PG', 'ca/14A', 'nl/AL', 'nl/6', 'nl/9', 'nl/12', 'nl/14']) {
    assert.ok(list.includes(v), `contains ${v}`);
  }
  for (const v of ['R', 'TV-MA', 'NC-17', 'gb/15', 'gb/18', 'de/16', 'de/18', 'au/MA15+', 'au/R18+', 'ca/18A', 'ca/R', 'fr/16', 'fr/18', 'nl/16', 'nl/18']) {
    assert.ok(!list.includes(v), `omits ${v}`);
  }
  assert.equal(new Set(list).size, list.length, 'no duplicates');
});

test('every value in allowedValues(limit) is allowed by allows(limit) and every other table value is not', () => {
  for (const limit of LIMITS) {
    const list = allowedValues(limit);
    const everything = [...allowedValues('NC-17')];
    for (const v of everything) assert.equal(list.includes(v), allows(limit, v), `${limit} ${v}`);
  }
});

test('allowedValues grows with the limit', () => {
  const sizes = LIMITS.map((l) => allowedValues(l).length);
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
  assert.ok(allowedValues('R').includes('TV-MA'));
  assert.ok(allowedValues('R').includes('gb/15'));
  assert.ok(!allowedValues('R').includes('NC-17'));
  assert.ok(allowedValues('NC-17').includes('NC-17'));
  assert.deepEqual(allowedValues('G').filter((v) => !v.includes('/')).sort(), ['G', 'TV-G', 'TV-Y']);
});
