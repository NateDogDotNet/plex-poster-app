// Metadata overlay (R-NP-2): content rating, runtime and year in the title-card slot, plus the must-fix this
// phase owns for the household limit: C8I1 / D37, re-rating the cached titles with one batched request.
//
// Mock item 3 is "Velvet Curtain": PG-13, 8,040,000 ms, 1972. Item 8 ("Encore", 2023) has no rating and no runtime.
// Every case runs against its own mock Plex (serveArgs: []). Pixel shift is off (convention 7).

import assert from 'node:assert/strict';
import { withApp } from './lib.mjs';

const cases = [];
const metaCase = (name, opts, fn) => cases.push({ name, opts: { serveArgs: [], ...opts }, fn });
const check = (name) => console.log(`  ok  ${name}`);

const TITLES = ['The Grand Marquee', 'Midnight Projector', 'Velvet Curtain', 'Popcorn Skies', 'Neon Matinee', 'Last Reel', 'Silver Screen Serenade', 'Encore'];
const titleNo = (alt) => TITLES.indexOf((alt || '').replace(/^Poster: /, '')) + 1;

const seed = (extra = {}) => (app) => ({
  plexToken: 'demo-token',
  serverUrl: `http://127.0.0.1:${app.mockPort}`,
  libraryKey: '1',
  rotateSeconds: 3600,
  showNowPlaying: false,
  pixelShift: false,
  ...extra,
});
const pinned = (key, title, extra = {}) => seed({ staticRatingKey: key, staticTitle: title, ...extra });

const activeAlt = (page) => page.evaluate(() => document.querySelector('.poster-layer.active')?.alt || '');
const posterShown = (page) => page.waitForFunction(() => [...document.querySelectorAll('.poster-layer.active')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 });
const index = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('plexPoster.posterIndex') || '[]'));
const card = async (page) => ({ hidden: await page.evaluate(() => document.getElementById('title-card').hidden), text: await page.evaluate(() => document.getElementById('title-card').textContent) });
const cardText = async (page) => {
  await page.waitForSelector('#title-card:not([hidden])', { timeout: 15000 });
  return page.evaluate(() => document.getElementById('title-card').textContent);
};

async function showNext(page) {
  await page.evaluate(() => document.querySelector('[data-action="refresh"]').click());
  await page.waitForTimeout(250);
}
async function until(what, fn, ms = 15000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${what} did not happen within ${ms} ms (last: ${last})`);
}
async function setHouseholdLimitInUI(page) {
  await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
  await page.waitForSelector('#settings[open]');
  await page.check('#household-toggle');
  await page.click('#settings-save');
}

// 1. showMeta:true -> exactly "PG-13 · 2 h 14 m · 1972" for mock item 3 (no title in it).
metaCase('1 showMeta text for item 3', { settings: pinned('3', 'Velvet Curtain', { showMeta: true, showTitle: false }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  const text = await cardText(page);
  assert.match(text, /^PG-13 · 2 h 14 m · 1972$/);
  assert.equal(await page.isVisible('#title-card'), true);
  check(`showMeta:true: #title-card reads "${text}"`);
});

// 2. Missing fields are omitted without a stray separator (item 8 has a year only).
metaCase('2 missing fields leave no stray separator', { settings: pinned('8', 'Encore', { showMeta: true }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  assert.match(await cardText(page), /^2023$/);
  check('an unrated item with no runtime shows only "2023"');
});

// 3. showMeta:false and showTitle:false -> hidden; showTitle alone is the 2.0.0 line; both show both.
metaCase('3 showMeta off and showTitle off hides the card', { settings: pinned('3', 'Velvet Curtain', { showMeta: false, showTitle: false }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  await page.waitForTimeout(500);
  const c = await card(page);
  assert.equal(c.hidden, true);
  assert.equal(c.text, '');
  assert.equal(await page.isVisible('#title-card'), false);
  check('showMeta:false and showTitle:false: #title-card is hidden and empty');
});
metaCase('4 showTitle alone behaves as in 2.0.0', { settings: pinned('3', 'Velvet Curtain', { showMeta: false, showTitle: true }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  assert.equal(await cardText(page), 'Velvet Curtain (1972)');
  check('showTitle:true alone: "Velvet Curtain (1972)"');
});
metaCase('5 showTitle and showMeta together show both', { settings: pinned('3', 'Velvet Curtain', { showMeta: true, showTitle: true }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  const text = await cardText(page);
  assert.ok(text.includes('Velvet Curtain (1972)') && text.includes('PG-13 · 2 h 14 m · 1972'), text);
  check(`both on: ${JSON.stringify(text)}`);
});

// 6. The index entry carries duration and contentRating (and no summary); the overlay works from the cache offline,
//    and a cache entry missing fields leaves no stray separators.
metaCase('6 cache index and offline overlay', { settings: pinned('3', 'Velvet Curtain', { showMeta: true }), clock: { time: '2026-01-05T12:00:00' } }, async ({ page, app, mock }) => {
  await page.goto(app.url);
  await posterShown(page);
  await cardText(page);
  const entry = await until('the cache index entry', async () => (await index(page)).find((e) => e.ratingKey === '3'));
  assert.equal(entry.duration, 8040000);
  assert.equal(entry.contentRating, 'PG-13');
  assert.equal(entry.year, '1972');
  assert.ok(!('summary' in entry), 'the summary is not stored');
  assert.deepEqual(Object.keys(entry).sort(), ['contentRating', 'duration', 'height', 'ratingKey', 'savedAt', 'thumb', 'title', 'width', 'year']);
  check('the poster-cache index entry carries duration, contentRating and year (no summary)');

  await mock.down();
  await page.reload();
  await posterShown(page);
  assert.equal(await activeAlt(page), 'Poster: Velvet Curtain');
  assert.match(await cardText(page), /^PG-13 · 2 h 14 m · 1972$/);
  check('offline, from the cache: the overlay still reads "PG-13 · 2 h 14 m · 1972"');

  const rewrite = (drop) =>
    page.evaluate((drop) => {
      const list = JSON.parse(localStorage.getItem('plexPoster.posterIndex')).map((e) => {
        const copy = { ...e };
        for (const k of drop) delete copy[k];
        return copy;
      });
      localStorage.setItem('plexPoster.posterIndex', JSON.stringify(list));
    }, drop);
  await rewrite(['year']);
  await page.reload();
  await posterShown(page);
  assert.match(await cardText(page), /^PG-13 · 2 h 14 m$/);
  await rewrite(['contentRating']);
  await page.reload();
  await posterShown(page);
  assert.match(await cardText(page), /^2 h 14 m$/);
  await rewrite(['duration']);
  await page.reload();
  await posterShown(page);
  await page.waitForTimeout(500);
  assert.equal((await card(page)).hidden, true, 'nothing to show: the card is hidden, not an empty bar');
  check('cached entries missing year / rating / runtime: no stray separators; nothing left: hidden');
});

// 7. The overlay never outlives its poster: an above-limit poster taken off the screen takes its metadata with it.
metaCase('7 a blocked poster takes its metadata with it', { settings: seed({ showMeta: true, randomPoolSize: 8 }) }, async ({ page, app, mock }) => {
  await page.goto(app.url);
  await posterShown(page);
  for (let i = 0; i < 200 && titleNo(await activeAlt(page)) !== 4; i++) await showNext(page);
  assert.equal(titleNo(await activeAlt(page)), 4, 'title 4 (R) is on screen');
  assert.match(await cardText(page), /^R · /);
  await mock.down();
  await setHouseholdLimitInUI(page);
  await until('title 4 off the screen', async () => titleNo(await activeAlt(page)) !== 4 || (await page.evaluate(() => document.body.classList.contains('poster-blocked'))), 3000);
  const text = await page.evaluate(() => (document.getElementById('title-card').hidden ? '' : document.getElementById('title-card').textContent));
  assert.ok(!/^R · /.test(text), `the R title's metadata is gone: ${JSON.stringify(text)}`);
  check('R poster blocked by a new PG-13 limit: its "R · ..." overlay is gone with it');
});

// 8. C8I1 (D37): while a limit is set, an online pool load re-checks the cached titles with ONE batched request, so a
//    title re-rated upward since it was cached is not shown offline.
metaCase('8 C8I1 re-rated title is never shown offline', { settings: seed({ randomPoolSize: 8 }), clock: { time: '2026-01-05T12:00:00' } }, async ({ page, app, mock }) => {
  await mock.post('rate', { ratingKey: '4', contentRating: 'PG' }); // title 4 starts out PG ...
  await page.goto(app.url);
  await posterShown(page);
  for (let i = 0; i < 200 && (await index(page)).length < 8; i++) await showNext(page);
  const cached = await index(page);
  assert.equal(cached.length, 8, 'all 8 titles are cached');
  assert.equal(cached.find((e) => e.ratingKey === '4').contentRating, 'PG', 'cached as PG');
  check('all 8 titles cached; title 4 stored as PG');

  await mock.post('rate', { ratingKey: '4', contentRating: 'R' }); // ... and is re-rated to R afterwards
  await mock.post('reset-stats');
  await setHouseholdLimitInUI(page); // Save PG-13: a new pool load while online
  await until('the stored rating of title 4 to follow Plex', async () => (await index(page)).find((e) => e.ratingKey === '4')?.contentRating === 'R');

  const batched = (await mock.get('log')).requests.filter((r) => r.startsWith('/library/metadata/') && r.includes(','));
  assert.equal(batched.length, 1, `exactly one batched metadata request (saw ${JSON.stringify(batched)})`);
  const keys = batched[0].replace(/\?.*$/, '').split('/').pop().split(',');
  assert.deepEqual([...keys].sort(), ['1', '2', '3', '4', '5', '6', '7', '8'], 'it names every cached key');
  const after = Object.fromEntries((await index(page)).map((e) => [e.ratingKey, e.contentRating]));
  assert.deepEqual(after, { 1: 'G', 2: 'PG', 3: 'PG-13', 4: 'R', 5: 'TV-MA', 6: 'gb/12', 7: 'gb/15', 8: '' });
  check('one online pool load under PG-13: one batched GET /library/metadata/1,...,8; the index now says title 4 is R');

  await mock.down();
  await page.reload();
  await posterShown(page);
  const seen = new Set([titleNo(await activeAlt(page))]);
  for (let i = 0; i < 24; i++) {
    await page.clock.runFor(361_000);
    await page.waitForTimeout(300);
    seen.add(titleNo(await activeAlt(page)));
  }
  assert.ok(!seen.has(4), `offline under PG-13 never showed title 4 (shown: ${[...seen].sort()})`);
  for (const t of seen) assert.ok([1, 2, 3, 6].includes(t), `offline under PG-13 showed title ${t}`);
  assert.ok(seen.size >= 2, `the offline rotation rotated: ${[...seen].sort()}`);
  check(`24 offline rotations after the re-rating never show title 4 (shown: ${[...seen].sort()})`);
});

// ---------- run ----------

const WORKERS = Number(process.env.E2E_META_WORKERS || 3);
if (process.env.E2E_META_ONLY) {
  const only = new RegExp(process.env.E2E_META_ONLY);
  cases.splice(0, cases.length, ...cases.filter((c) => only.test(c.name)));
}
const failures = [];
let nextCase = 0;
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (nextCase < cases.length) {
      const { name, opts, fn } = cases[nextCase++];
      try {
        await withApp(opts, fn);
        console.log(`PASS case ${name}`);
      } catch (err) {
        failures.push({ name, err });
      }
    }
  }),
);
for (const { name, err } of failures) console.error(`case ${name} failed:\n${err?.stack || err}`);
if (failures.length) process.exit(1);
