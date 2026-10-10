// Household content limit (R-FILT-1, D5): random posters, cached offline posters and now-playing never exceed
// the chosen rating. The mock's 8 titles carry G, PG, PG-13, R, TV-MA, gb/12, gb/15 and no rating (titles 1-8).
// Also the two must-fixes this phase owns: K5 (offline fallback with an undecodable cached poster) and A8-d (the
// heal download is not drawn when sleep began during it).
//
// Every case runs against its own mock Plex (serveArgs: []) so cases run side by side.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, withApp } from './lib.mjs';

const cases = [];
const contentCase = (name, opts, fn) => cases.push({ name, opts: { serveArgs: [], ...opts }, fn });
const check = (name) => console.log(`  ok  ${name}`);

const TITLES = ['The Grand Marquee', 'Midnight Projector', 'Velvet Curtain', 'Popcorn Skies', 'Neon Matinee', 'Last Reel', 'Silver Screen Serenade', 'Encore'];
const titleNo = (alt) => TITLES.indexOf((alt || '').replace(/^Poster: /, '')) + 1; // 0 = nothing recognisable

const seed = (extra = {}) => (app) => ({
  plexToken: 'demo-token',
  serverUrl: `http://127.0.0.1:${app.mockPort}`,
  libraryKey: '1',
  rotateSeconds: 3600,
  showNowPlaying: false,
  ...extra,
});

const activeAlt = (page) => page.evaluate(() => document.querySelector('.poster-layer.active')?.alt || '');
const activeCount = (page) => page.evaluate(() => document.querySelectorAll('.poster-layer.active').length);
const posterShown = (page) => page.waitForFunction(() => [...document.querySelectorAll('.poster-layer.active')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 });
const index = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('plexPoster.posterIndex') || '[]'));
const storedSettings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('plexPoster.settings')));
const patchSettings = (page, patch) =>
  page.evaluate((p) => localStorage.setItem('plexPoster.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('plexPoster.settings')), ...p })), patch);

/** Click the refresh control and give the tick time to finish (a click during a busy tick is ignored). */
async function showNext(page) {
  await page.evaluate(() => document.querySelector('[data-action="refresh"]').click());
  await page.waitForTimeout(250);
}

/** Polls (real time) until the active poster is title `n`; fails after `ms`. */
async function waitForTitle(page, n, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (titleNo(await activeAlt(page)) === n) return;
    await page.waitForTimeout(50);
  }
  assert.fail(`title ${n} did not come up within ${ms} ms (on screen: ${titleNo(await activeAlt(page))})`);
}

/** Polls (real time) until the active poster is one PG-13 allows (titles 1, 2, 3, 6); fails after `ms`. */
async function waitForAllowedTitle(page, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ([1, 2, 3, 6].includes(titleNo(await activeAlt(page)))) return;
    await page.waitForTimeout(50);
  }
  assert.fail(`no allowed title (1, 2, 3 or 6) came up within ${ms} ms (on screen: ${titleNo(await activeAlt(page))})`);
}

/** Refreshes `n` times and returns the set of title numbers on screen after each. */
async function sample(page, n) {
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    await showNext(page);
    seen.add(titleNo(await activeAlt(page)));
  }
  return seen;
}

/** Refreshes until every title in `want` has been seen (bounded); returns everything seen. */
async function sampleUntil(page, want, max = 250) {
  const seen = new Set();
  for (let i = 0; i < max && !want.every((t) => seen.has(t)); i++) {
    await showNext(page);
    seen.add(titleNo(await activeAlt(page)));
  }
  return seen;
}

const libraryRequests = (page) => {
  const urls = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/library/sections/1/all') urls.push(u);
  });
  return urls;
};
const sentRatings = (u) => (u.searchParams.get('contentRating') || '').split(',').filter(Boolean);

const asSorted = (set) => [...set].sort((a, b) => a - b);

// 1. PG-13: the request lists gb/12 (and nothing above), and 50 refreshes show only titles 1, 2, 3 and 6.
contentCase('1 PG-13 random posters', { settings: seed({ maxContentRating: 'PG-13' }) }, async ({ page, app }) => {
  const requests = libraryRequests(page);
  await page.goto(app.url);
  await posterShown(page);
  assert.ok(requests.length >= 1, 'the library was requested');
  const sent = sentRatings(requests[0]);
  for (const v of ['G', 'PG', 'PG-13', 'TV-14', 'gb/12', 'gb/12A', 'de/12', 'fr/12', 'au/M', 'ca/14A', 'nl/12']) assert.ok(sent.includes(v), `request lists ${v}`);
  for (const v of ['R', 'TV-MA', 'NC-17', 'gb/15']) assert.ok(!sent.includes(v), `request omits ${v}`);
  assert.equal(requests[0].searchParams.get('X-Plex-Container-Size'), '300', 'oversampled: 3 x the default pool of 100');
  check('PG-13 request: contentRating lists gb/12 and every allowed value, none above; container size 300');

  const seen = await sample(page, 50);
  assert.deepEqual(asSorted(seen), [1, 2, 3, 6], `titles shown: ${asSorted(seen)}`);
  check('50 refreshes under PG-13 show only titles 1, 2, 3 and 6 (all four appear)');
});

// 2. R: the same rung (TV-MA, and gb/15 by the table) joins; the unrated title never does.
contentCase('2 R random posters', { settings: seed({ maxContentRating: 'R' }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  const seen = await sampleUntil(page, [1, 2, 3, 4, 5, 6, 7]);
  const more = await sample(page, 30);
  const all = new Set([...seen, ...more]);
  assert.ok(all.has(4) && all.has(5), `titles 4 and 5 appear under R: ${asSorted(all)}`);
  assert.ok(!all.has(8), 'the unrated title never appears under a limit');
  assert.ok(!all.has(0), 'every refresh showed a mock title');
  check(`under R titles 4 (R) and 5 (TV-MA) also appear, and 7 (gb/15); never 8 (unrated): ${asSorted(all)}`);
});

// 3. No limit: all 8 appear, and no rating filter is requested.
contentCase('3 no limit', { settings: seed({ maxContentRating: '' }) }, async ({ page, app }) => {
  const requests = libraryRequests(page);
  await page.goto(app.url);
  await posterShown(page);
  const seen = await sampleUntil(page, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(asSorted(seen), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const u of requests) {
    assert.equal(u.searchParams.has('contentRating'), false, 'no filter parameter without a limit');
    assert.equal(u.searchParams.get('X-Plex-Container-Size'), '100');
  }
  check('limit "": all 8 titles appear; no contentRating parameter; container size = pool size');
});

// 4. Cached posters: title 4 (R) cached with no limit is never shown offline under PG-13 (20 offline rotations).
//    Also a pre-2.1 index (no stored ratings): nothing is shown offline while a limit is set.
contentCase('4 cached posters offline', { settings: seed({ rotateSeconds: 10 }), clock: { time: '2026-01-05T12:00:00' } }, async ({ page, app, mock }) => {
  await page.goto(app.url);
  await posterShown(page);
  for (let i = 0; i < 200 && (await index(page)).length < 8; i++) await showNext(page);
  const entries = await index(page);
  assert.equal(entries.length, 8, 'all 8 posters are cached');
  assert.equal(entries.find((e) => e.ratingKey === '4').contentRating, 'R', 'the index entry stores the rating');
  assert.equal(entries.find((e) => e.ratingKey === '8').contentRating, '', 'an unrated title stores ""');
  check('no limit: title 4 (R) was shown and cached; the index stores contentRating');

  await patchSettings(page, { maxContentRating: 'PG-13' });
  await mock.down();
  await page.reload();
  await posterShown(page);
  const seen = new Set([titleNo(await activeAlt(page))]);
  for (let i = 0; i < 20; i++) {
    await page.clock.runFor(361_000); // past the longest retry backoff, so one failed tick per step
    await page.waitForTimeout(300);
    seen.add(titleNo(await activeAlt(page)));
  }
  for (const t of seen) assert.ok([1, 2, 3, 6].includes(t), `offline under PG-13 showed title ${t}`);
  assert.ok(seen.size >= 2, `the offline rotation rotated: ${asSorted(seen)}`);
  check(`20 offline rotations under PG-13 never show title 4 (shown: ${asSorted(seen)})`);

  // A cache written before 2.1 has no ratings: every entry is skipped while a limit is set.
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('plexPoster.posterIndex')).map((entry) => {
      const unrated = { ...entry };
      delete unrated.contentRating;
      return unrated;
    });
    localStorage.setItem('plexPoster.posterIndex', JSON.stringify(list));
  });
  await page.reload();
  await page.waitForTimeout(1500);
  assert.equal(await activeCount(page), 0, 'no cached poster is shown without a stored rating');
  assert.equal(await page.isVisible('#empty'), true, 'the empty card explains');
  check('cached entries without a stored rating (pre-2.1) are never shown offline while a limit is set');
});

// 5. Now-playing: title 4 (R) playing under PG-13 is not displayed; limitNowPlaying:false shows it.
contentCase('5 now-playing', { settings: seed({ maxContentRating: 'PG-13', showNowPlaying: true, nowPlayingPollSeconds: 5 }) }, async ({ page, app, mock }) => {
  await mock.play('4');
  await page.goto(app.url);
  await posterShown(page);
  const seen = await sample(page, 20);
  assert.ok(!seen.has(4), `title 4 is not displayed while playing under PG-13: ${asSorted(seen)}`);
  for (const t of seen) assert.ok([1, 2, 3, 6].includes(t), `title ${t}`);
  check('mock.play(4) under PG-13: title 4 is never displayed; a random allowed poster is');

  await patchSettings(page, { limitNowPlaying: false });
  await page.reload();
  await posterShown(page);
  assert.equal(titleNo(await activeAlt(page)), 4, 'limitNowPlaying:false shows the playing title');
  check('limitNowPlaying:false: the playing R title is displayed');

  await patchSettings(page, { limitNowPlaying: true, maxContentRating: '' });
  await page.reload();
  await posterShown(page);
  assert.equal(titleNo(await activeAlt(page)), 4, 'no limit shows the playing title');
  check('no limit: the playing title is displayed');
});

// 6. The "Household with children" toggle in Settings sets and clears maxContentRating, defaulting to PG-13.
contentCase('6 household toggle', { settings: seed() }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  const open = async () => {
    await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
    await page.waitForSelector('#settings[open]');
  };
  const save = async () => {
    await page.click('#settings-save');
    await page.waitForFunction(() => !document.getElementById('settings').open);
  };

  await open();
  assert.equal(await page.isChecked('#household-toggle'), false);
  assert.equal(await page.isVisible('select[name="maxContentRating"]'), false, 'the select is hidden while off');
  assert.equal(await page.isVisible('input[name="limitNowPlaying"]'), false, 'limitNowPlaying is hidden while off');
  await page.check('#household-toggle');
  assert.equal(await page.isVisible('select[name="maxContentRating"]'), true);
  assert.equal(await page.inputValue('select[name="maxContentRating"]'), 'PG-13', 'defaults to PG-13');
  assert.equal(await page.isVisible('input[name="limitNowPlaying"]'), true, 'limitNowPlaying shown while a limit is set');
  assert.equal(await page.isChecked('input[name="limitNowPlaying"]'), true, 'and on by default');
  await save();
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13');
  check('toggle on -> Save stores maxContentRating PG-13 (limitNowPlaying visible, on)');

  await open();
  assert.equal(await page.isChecked('#household-toggle'), true);
  assert.equal(await page.inputValue('select[name="maxContentRating"]'), 'PG-13');
  await page.selectOption('select[name="maxContentRating"]', 'R');
  await page.uncheck('input[name="limitNowPlaying"]');
  await save();
  const s = await storedSettings(page);
  assert.equal(s.maxContentRating, 'R');
  assert.equal(s.limitNowPlaying, false);
  check('the select changes the limit (R) and limitNowPlaying can be switched off');

  await open();
  assert.equal(await page.inputValue('select[name="maxContentRating"]'), 'R');
  await page.uncheck('#household-toggle');
  assert.equal(await page.isVisible('select[name="maxContentRating"]'), false);
  assert.equal(await page.isVisible('input[name="limitNowPlaying"]'), false);
  await save();
  assert.equal((await storedSettings(page)).maxContentRating, '', 'toggle off stores ""');
  check('toggle off -> Save clears maxContentRating to ""');

  await open();
  assert.equal(await page.isChecked('#household-toggle'), false);
  await page.check('#household-toggle');
  assert.equal(await page.inputValue('select[name="maxContentRating"]'), 'PG-13', 'back to the PG-13 default after being off');
  await page.click('#settings-cancel');
  assert.equal((await storedSettings(page)).maxContentRating, '', 'Cancel stores nothing');
  check('toggling on again defaults to PG-13; Cancel changes nothing');
});

// 7. Turning the limit on replaces a poster that is already up and now above it, without waiting for the rotation.
contentCase('7 tightening the limit replaces the poster on screen', { settings: seed({ randomPoolSize: 4 }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  const seen = await sampleUntil(page, [4]);
  // A refresh can still be finishing when the sample was read (a loaded machine): wait for title 4 to be the one up.
  await waitForTitle(page, 4);
  assert.equal(titleNo(await activeAlt(page)), 4, 'title 4 (R) is on screen');
  await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
  await page.waitForSelector('#settings[open]');
  await page.check('#household-toggle');
  await page.click('#settings-save');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  let shown = 4;
  for (let i = 0; i < 40 && shown === 4; i++) {
    await page.waitForTimeout(100);
    shown = titleNo(await activeAlt(page));
  }
  assert.ok([1, 2, 3, 6].includes(shown), `PG-13 saved while title 4 is up: now showing ${shown} (seen before: ${asSorted(seen)})`);
  check('saving PG-13 while title 4 (R) is up replaces it at once');
});

// 8. K5: the offline fallback must not keep a poster whose cached blob will not decode: the entry is dropped and
//    another is tried (or none). No loop, no uncaught error.
contentCase('8 K5 undecodable cached poster offline', { settings: seed({ rotateSeconds: 10, randomPoolSize: 2 }), clock: { time: '2026-01-05T12:00:00' } }, async ({ page, app, mock }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(app.url);
  await posterShown(page);
  for (let i = 0; i < 100 && (await index(page)).length < 2; i++) await showNext(page);
  assert.deepEqual((await index(page)).map((e) => e.ratingKey).sort(), ['1', '2'], 'titles 1 and 2 are cached');
  await page.evaluate(async () => {
    const cache = await caches.open('plex-posters-v1');
    await cache.put(new URL('/__posters__/1', location.origin).toString(), new Response('garbage', { headers: { 'Content-Type': 'image/jpeg' } }));
  });
  await mock.down();
  await page.reload();
  await posterShown(page);
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(361_000);
    await page.waitForTimeout(300);
  }
  assert.deepEqual((await index(page)).map((e) => e.ratingKey), ['2'], 'the undecodable entry (title 1) was dropped from the index');
  assert.equal(titleNo(await activeAlt(page)), 2, 'and the good cached poster is on screen');
  assert.deepEqual(errors, []);
  check('offline: an undecodable cached poster is deleted and another is shown; no uncaught error');

  // Both undecodable: both are dropped and none is shown (no loop).
  await page.evaluate(async () => {
    const cache = await caches.open('plex-posters-v1');
    await cache.put(new URL('/__posters__/2', location.origin).toString(), new Response('garbage', { headers: { 'Content-Type': 'image/jpeg' } }));
  });
  await page.reload();
  await page.waitForTimeout(1500);
  assert.deepEqual(await index(page), [], 'every undecodable entry is dropped');
  assert.equal(await activeCount(page), 0, 'nothing is shown');
  assert.deepEqual(errors, []);
  check('offline with every cached poster undecodable: all dropped, nothing shown, no loop');
});

// 9. A8-d: the heal path's second download is not drawn when sleep began while it was in flight (like sleep case 21).
contentCase('9 A8-d heal download vs sleep', { settings: seed({ randomPoolSize: 2, sleepEnabled: true }), clock: { time: '2026-01-05T00:30:00' } }, async ({ page, app }) => {
  let held = null;
  let hold = false;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(/\/photo\/:\/transcode/, async (route) => {
    if (!hold) return route.continue();
    held = route;
    await gate;
    return route.continue();
  });
  await page.goto(app.url);
  await posterShown(page);
  for (let i = 0; i < 100 && (await index(page)).length < 2; i++) await showNext(page);
  assert.equal((await index(page)).length, 2, 'both posters are cached');
  const before = await activeAlt(page);
  await page.evaluate(async () => {
    const cache = await caches.open('plex-posters-v1');
    for (const req of await cache.keys()) await cache.put(req, new Response('garbage', { headers: { 'Content-Type': 'image/jpeg' } }));
  });
  hold = true;
  await page.evaluate(() => document.querySelector('[data-action="refresh"]').click()); // the other poster: cached, undecodable, healing
  for (let i = 0; i < 100 && !held; i++) await page.waitForTimeout(50);
  assert.ok(held, 'the heal re-download is in flight');
  await page.clock.setSystemTime(new Date('2026-01-05T00:59:58'));
  await page.clock.runFor(4000); // the sleep window opens while it is parked
  await page.waitForFunction(() => document.body.classList.contains('asleep'), null, { timeout: 15000 });
  hold = false;
  release();
  await page.waitForTimeout(800); // the download completes
  assert.equal(await activeAlt(page), before, 'the re-downloaded poster is not drawn under the veil');
  assert.equal(await page.evaluate(() => document.body.classList.contains('asleep')), true);
  check('heal download in flight when the sleep window opens: not drawn under the veil');
});

// 10/11. K20: while OFFLINE, setting a limit replaces the poster on screen at once when it is above the new
//    limit: by an allowed cached poster if one exists (10), otherwise by the empty card with no poster (11).
//    Title 4 (R) never comes back over several offline rotations.
const offlineLimitOpts = { settings: seed({ rotateSeconds: 10, randomPoolSize: 4 }), clock: { time: '2026-01-05T12:00:00' } };

async function showTitle4NoLimit(page, url) {
  await page.goto(url);
  await posterShown(page);
  const seen = await sampleUntil(page, [4]);
  assert.ok(seen.has(4), 'title 4 (R) was shown with no limit');
  assert.equal(titleNo(await activeAlt(page)), 4, 'title 4 is on screen');
}

async function setHouseholdLimitInUI(page) {
  await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
  await page.waitForSelector('#settings[open]');
  await page.check('#household-toggle');
  await page.click('#settings-save');
}

/** Polls (real time) until title 4 is no longer the active poster; returns the ms it took, or null if it never left. */
async function msUntilTitle4Gone(page, budget = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < budget) {
    if (titleNo(await activeAlt(page)) !== 4) return Date.now() - t0;
    await page.waitForTimeout(50);
  }
  return null;
}

contentCase('10 K20 offline limit change, allowed cached poster available', offlineLimitOpts, async ({ page, app, mock }) => {
  await showTitle4NoLimit(page, app.url);
  for (let i = 0; i < 100 && (await index(page)).filter((e) => ['1', '2', '3', '4'].includes(e.ratingKey)).length < 4; i++) await showNext(page);
  await showTitle4NoLimit(page, app.url);
  await mock.down();
  await setHouseholdLimitInUI(page);
  const took = await msUntilTitle4Gone(page);
  assert.notEqual(took, null, 'title 4 (R) stays on screen offline after PG-13 is saved');
  assert.ok(took <= 1500, `title 4 left the screen within ~1 s (took ${took} ms)`);
  await page.waitForTimeout(500);
  assert.ok([1, 2, 3].includes(titleNo(await activeAlt(page))), `an allowed cached poster replaced it: ${await activeAlt(page)}`);
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    await page.clock.runFor(361_000);
    await page.waitForTimeout(300);
    seen.add(titleNo(await activeAlt(page)));
  }
  for (const t of seen) assert.ok([1, 2, 3].includes(t), `offline rotation showed title ${t}`);
  assert.ok(seen.size >= 2, `the offline rotation rotated: ${asSorted(seen)}`);
  check(`offline: PG-13 saved while title 4 is up -> replaced within ${took} ms by a cached allowed poster; 8 rotations never return it (${asSorted(seen)})`);
});

contentCase('11 K20 offline limit change, no allowed cached poster', offlineLimitOpts, async ({ page, app, mock }) => {
  await showTitle4NoLimit(page, app.url);
  await page.evaluate(async () => {
    const cache = await caches.open('plex-posters-v1');
    for (const req of await cache.keys()) if (!req.url.endsWith('/4')) await cache.delete(req);
    const only4 = JSON.parse(localStorage.getItem('plexPoster.posterIndex')).filter((e) => e.ratingKey === '4');
    localStorage.setItem('plexPoster.posterIndex', JSON.stringify(only4));
  });
  assert.deepEqual((await index(page)).map((e) => e.ratingKey), ['4'], 'only title 4 is cached');
  await mock.down();
  await setHouseholdLimitInUI(page);
  const took = await msUntilTitle4Gone(page);
  assert.notEqual(took, null, 'title 4 (R) stays on screen offline after PG-13 is saved');
  assert.ok(took <= 1500, `title 4 left the screen within ~1 s (took ${took} ms)`);
  await page.waitForTimeout(500);
  assert.equal(await activeCount(page), 0, 'no poster layer is active');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.poster-layer')].some((i) => getComputedStyle(i).opacity !== '0')), false, 'no poster layer is visible');
  assert.equal(await page.isVisible('#empty'), true, 'the empty card is shown');
  assert.match(await page.textContent('#empty-message'), /household limit/i);
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(361_000);
    await page.waitForTimeout(300);
    assert.equal(await activeCount(page), 0, `rotation ${i + 1}: still no poster`);
    assert.equal(await page.isVisible('#empty'), true);
  }
  assert.equal((await index(page)).length, 1, 'title 4 is still cached (it is not deleted, only never shown)');
  check(`offline: PG-13 saved while title 4 is up and nothing allowed is cached -> poster gone within ${took} ms, empty card, 4 rotations show nothing`);
});

// 12/13. R4: a tick already downloading a poster when a stricter limit is saved must not draw it. The check runs
//    against the CURRENT settings immediately before the draw; a poster that fails it is not drawn and not marked
//    shown, and the next tick picks another (an allowed one ends up on screen). Title 4 (R) is held in flight.
const isTitle4Image = (request) => {
  const u = new URL(request.url());
  return u.pathname === '/photo/:/transcode' && (u.searchParams.get('url') || '').startsWith('/library/metadata/4/');
};

/** Records the alt of every active poster layer, on every DOM change, into window.__activeAlts. */
const recordActiveAlts = (page) =>
  page.addInitScript(() => {
    const seen = (window.__activeAlts = new Set());
    new MutationObserver(() => document.querySelectorAll('.poster-layer.active').forEach((i) => seen.add(i.alt))).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'alt', 'src'],
    });
  });
const everActive = (page) => page.evaluate(() => [...window.__activeAlts]);

contentCase('12 R4 in-flight download vs a stricter limit', { settings: seed({ randomPoolSize: 4 }) }, async ({ page, app }) => {
  let held = null;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(/\/photo\/:\/transcode/, async (route) => {
    if (!isTitle4Image(route.request())) return route.continue();
    held ??= route;
    await gate;
    return route.continue();
  });
  await recordActiveAlts(page);
  await page.goto(app.url);
  for (let i = 0; i < 300 && !held; i++) {
    if (i % 5 === 4) await page.evaluate(() => document.querySelector('[data-action="refresh"]')?.click());
    await page.waitForTimeout(100);
  }
  assert.ok(held, 'a rotation picked title 4 and its image download is in flight (no limit)');
  await setHouseholdLimitInUI(page);
  await page.waitForFunction(() => !document.getElementById('settings').open);
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13');
  release(); // the download completes now, under the stricter limit
  let shown = 0;
  for (let i = 0; i < 80 && ![1, 2, 3, 6].includes(shown); i++) {
    await page.waitForTimeout(100);
    shown = titleNo(await activeAlt(page));
  }
  assert.ok([1, 2, 3, 6].includes(shown), `the next tick picked an allowed poster (on screen: ${shown})`);
  await sample(page, 10);
  const ever = (await everActive(page)).map(titleNo);
  assert.ok(!ever.includes(4), `title 4 (R) was never drawn: ${ever}`);
  check(`PG-13 saved while title 4's download is in flight: never drawn; an allowed poster (${shown}) followed; drawn ever: ${[...new Set(ever)].sort()}`);
});

contentCase('13 R4 heal re-download in flight vs a stricter limit', { settings: seed({ randomPoolSize: 4 }) }, async ({ page, app }) => {
  let hold = false;
  let held = null;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(/\/photo\/:\/transcode/, async (route) => {
    if (!hold || !isTitle4Image(route.request())) return route.continue();
    held ??= route;
    await gate;
    return route.continue();
  });
  await recordActiveAlts(page);
  await page.goto(app.url);
  await posterShown(page);
  for (let i = 0; i < 250 && !(await index(page)).some((e) => e.ratingKey === '4'); i++) await showNext(page);
  assert.ok((await index(page)).some((e) => e.ratingKey === '4'), 'title 4 is cached');
  await page.evaluate(async () => {
    const cache = await caches.open('plex-posters-v1');
    await cache.put(new URL('/__posters__/4', location.origin).toString(), new Response('garbage', { headers: { 'Content-Type': 'image/jpeg' } }));
  });
  hold = true;
  for (let i = 0; i < 300 && !held; i++) {
    if (i % 5 === 4) await page.evaluate(() => document.querySelector('[data-action="refresh"]')?.click());
    await page.waitForTimeout(100);
  }
  assert.ok(held, 'title 4 was picked: its cached copy would not decode and the heal re-download is in flight');
  await page.evaluate(() => window.__activeAlts.clear()); // title 4 may have been up earlier, with no limit; watch from here on
  await setHouseholdLimitInUI(page);
  await page.waitForFunction(() => !document.getElementById('settings').open);
  release();
  let shown = 0;
  for (let i = 0; i < 80 && ![1, 2, 3, 6].includes(shown); i++) {
    await page.waitForTimeout(100);
    shown = titleNo(await activeAlt(page));
  }
  assert.ok([1, 2, 3, 6].includes(shown), `the next tick picked an allowed poster (on screen: ${shown})`);
  await page.waitForTimeout(500);
  const seenAfter = await sample(page, 8);
  assert.ok(!seenAfter.has(4), `title 4 never returns: ${asSorted(seenAfter)}`);
  const ever = (await everActive(page)).map(titleNo);
  assert.ok(!ever.includes(4), `title 4 (R) was never drawn after the save: ${ever}`);
  check(`PG-13 saved while title 4's heal re-download is in flight: not drawn; an allowed poster (${shown}) followed`);
});

// 14. CCI1: the settings live preview never loosens a saved limit. PG-13 saved; the household toggle is unticked in
//    the dialog WITHOUT saving and a Frame & layout control is changed (a live preview). Whatever the form says,
//    ticks keep using the saved limit: no title above PG-13 and no unrated title is ever drawn, with the dialog open
//    or after Cancel, and the stored limit is still PG-13.
contentCase('14 CCI1 live preview keeps the saved limit', { settings: seed({ maxContentRating: 'PG-13' }) }, async ({ page, app }) => {
  await recordActiveAlts(page);
  await page.goto(app.url);
  await posterShown(page);
  await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
  await page.waitForSelector('#settings[open]');
  await page.uncheck('#household-toggle');
  await page.selectOption('select[name="posterFit"]', 'contain'); // data-live: previews the whole form
  await page.selectOption('select[name="posterFit"]', 'cover');
  for (let i = 0; i < 40; i++) await showNext(page); // refresh = a forced tick, with the dialog open
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13', 'nothing was saved');
  let ever = (await everActive(page)).map(titleNo);
  assert.deepEqual([...new Set(ever)].filter((t) => ![1, 2, 3, 6].includes(t)), [], `dialog open: only titles within PG-13 were drawn: ${[...new Set(ever)].sort()}`);
  check(`unsaved household toggle off + layout preview: 40 refreshes drew only ${[...new Set(ever)].sort()}`);

  await page.click('#settings-cancel');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  await page.waitForTimeout(500);
  const after = titleNo(await activeAlt(page));
  assert.ok([1, 2, 3, 6].includes(after), `after Cancel an allowed poster is up (on screen: ${after})`);
  for (let i = 0; i < 10; i++) await showNext(page);
  ever = (await everActive(page)).map(titleNo);
  assert.deepEqual([...new Set(ever)].filter((t) => ![1, 2, 3, 6].includes(t)), [], `after Cancel too: ${[...new Set(ever)].sort()}`);
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13');
  check('Cancel: an allowed poster is on screen, none above the limit was ever drawn, the stored limit is still PG-13');
});

// 15. A3-rec: a limit saved while a tick is running must not lose its forced tick. With "now playing" on, a tick
//    that is only waiting for /status/sessions has already decided not to force; the limit is saved meanwhile and
//    the screen goes blank. When the tick ends, a forced one must follow at once (not after the next poll, 5 s on).
contentCase('15 A3-rec limit saved during a tick keeps its forced tick', { settings: seed({ randomPoolSize: 4, showNowPlaying: true, nowPlayingPollSeconds: 5 }) }, async ({ page, app }) => {
  let hold = false;
  let held = null;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(/\/status\/sessions/, async (route) => {
    if (!hold) return route.continue();
    held ??= route;
    await gate;
    return route.continue();
  });
  await page.goto(app.url);
  await posterShown(page);
  await sampleUntil(page, [4]);
  await waitForTitle(page, 4);
  hold = true;
  for (let i = 0; i < 200 && !held; i++) await page.waitForTimeout(50); // the next poll tick parks on /status/sessions
  assert.ok(held, 'a tick is running, waiting for /status/sessions');
  await setHouseholdLimitInUI(page);
  await page.waitForFunction(() => !document.getElementById('settings').open);
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13');
  assert.equal(await activeCount(page), 0, 'title 4 was taken off the screen by the save');
  hold = false;
  release();
  const t0 = Date.now();
  let shown = 0;
  for (let i = 0; i < 50 && ![1, 2, 3, 6].includes(shown); i++) {
    await page.waitForTimeout(100);
    shown = titleNo(await activeAlt(page));
  }
  const took = Date.now() - t0;
  assert.ok([1, 2, 3, 6].includes(shown) && took < 3000, `an allowed poster followed the running tick at once (on screen: ${shown}, ${took} ms)`);
  check(`limit saved while a tick waited on /status/sessions: the forced tick ran when it ended (poster ${shown} after ${took} ms)`);
});

// 16. A3-rec, as in the brief: an image request held in flight, a limit saved, the request released -> an allowed
//    poster is up promptly, with rotateSeconds = 1 hour.
contentCase('16 A3-rec image in flight, limit saved, released', { settings: seed({ randomPoolSize: 4 }) }, async ({ page, app }) => {
  let hold = false;
  let held = null;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(/\/photo\/:\/transcode/, async (route) => {
    if (!hold) return route.continue();
    held ??= route;
    await gate;
    return route.continue();
  });
  await page.goto(app.url);
  await posterShown(page);
  await sampleUntil(page, [4]);
  await waitForTitle(page, 4);
  await page.evaluate(async () => {
    // Forget every cached poster so the next pick has to download (a cache hit would not be in flight).
    const cache = await caches.open('plex-posters-v1');
    for (const req of await cache.keys()) await cache.delete(req);
    localStorage.removeItem('plexPoster.posterIndex');
  });
  hold = true;
  await page.evaluate(() => document.querySelector('[data-action="refresh"]').click());
  for (let i = 0; i < 100 && !held; i++) await page.waitForTimeout(50);
  assert.ok(held, 'a poster image is in flight');
  await setHouseholdLimitInUI(page);
  await page.waitForFunction(() => !document.getElementById('settings').open);
  hold = false;
  release();
  const t0 = Date.now();
  let shown = 0;
  for (let i = 0; i < 50 && ![1, 2, 3, 6].includes(shown); i++) {
    await page.waitForTimeout(100);
    shown = titleNo(await activeAlt(page));
  }
  assert.ok([1, 2, 3, 6].includes(shown), `an allowed poster is up after the release (on screen: ${shown}, ${Date.now() - t0} ms)`);
  await page.waitForTimeout(1500);
  assert.ok([1, 2, 3, 6].includes(titleNo(await activeAlt(page))), 'and it stays allowed');
  check(`image held, PG-13 saved, released: allowed poster ${shown} up after ${Date.now() - t0} ms`);
});

// 17. C4M1: a Save that tightens the limit AND changes to a slow custom frame must take the above-limit poster off
//    the screen at once, not after the frame has loaded (a custom frame load has no timeout). The frame request is
//    held for the whole check; the poster is gone while it is held, and an allowed one follows once it is released.
contentCase('17 C4M1 limit + slow custom frame in one Save', { settings: seed({ randomPoolSize: 4 }) }, async ({ page, app }) => {
  let held = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const frameBody = readFileSync(join(ROOT, 'assets', 'frames', 'marquee.png'));
  await page.route(/\/slow-frame\.png/, async (route) => {
    held++;
    await gate;
    return route.fulfill({ status: 200, contentType: 'image/png', body: frameBody });
  });
  await page.goto(app.url);
  await posterShown(page);
  await sampleUntil(page, [4]);
  await waitForTitle(page, 4);
  await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
  await page.waitForSelector('#settings[open]');
  await page.selectOption('select[name="frameId"]', 'custom');
  await page.fill('input[name="customFrameUrl"]', `${app.url}slow-frame.png`);
  await page.check('#household-toggle');
  await page.click('#settings-save');
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    await page.waitForTimeout(50);
    gone = (await activeCount(page)) === 0;
  }
  assert.ok(held >= 1, 'the custom frame request is in flight');
  assert.equal(gone, true, `title 4 (R) is off the screen while the frame is still loading (on screen: ${titleNo(await activeAlt(page))})`);
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13');
  release();
  let shown = 0;
  for (let i = 0; i < 80 && ![1, 2, 3, 6].includes(shown); i++) {
    await page.waitForTimeout(100);
    shown = titleNo(await activeAlt(page));
  }
  assert.ok([1, 2, 3, 6].includes(shown), `once the frame loaded an allowed poster followed (on screen: ${shown})`);
  check(`PG-13 + slow custom frame in one Save: title 4 gone while the frame was held (${held} request(s)); allowed poster ${shown} after release`);
});

// 18. C4I1: the re-check AFTER the image decode. A poster passes the pre-draw check, then a stricter limit is saved
//    while the browser is still decoding it. The decode is held from inside the page (HTMLImageElement.decode is
//    wrapped by an init script and parked until the test lets it go), so the window is open for as long as the test
//    needs. When the decode finishes the poster must be taken straight back down, not left up until the next tick:
//    the forced tick that follows is itself held at its decode, so only the re-check can clear the screen.
const holdDecodes = (page) =>
  page.addInitScript(() => {
    const real = HTMLImageElement.prototype.decode;
    const hold = (window.__decodeHold = { alt: null, all: false, parked: [] });
    HTMLImageElement.prototype.decode = function () {
      if (!(hold.all || (hold.alt && this.alt === hold.alt))) return real.call(this);
      return new Promise((resolve, reject) => hold.parked.push({ alt: this.alt, go: () => real.call(this).then(resolve, reject) }));
    };
  });
const parkedAlts = (page) => page.evaluate(() => window.__decodeHold.parked.map((p) => p.alt));
const releaseDecodes = (page) => page.evaluate(() => window.__decodeHold.parked.splice(0).forEach((p) => p.go()));

contentCase('18 C4I1 limit saved during a poster decode', { settings: seed({ randomPoolSize: 4 }) }, async ({ page, app }) => {
  await holdDecodes(page);
  await page.goto(app.url);
  await posterShown(page);
  await page.evaluate((alt) => (window.__decodeHold.alt = alt), `Poster: ${TITLES[3]}`); // title 4 (R)
  let parked = [];
  for (let i = 0; i < 300 && !parked.length; i++) {
    if (i % 5 === 4) await page.evaluate(() => document.querySelector('[data-action="refresh"]')?.click());
    await page.waitForTimeout(100);
    parked = await parkedAlts(page);
  }
  assert.deepEqual(parked.map(titleNo), [4], 'title 4 passed the pre-draw check and its decode is parked');
  assert.notEqual(titleNo(await activeAlt(page)), 4, 'title 4 is not on screen yet');

  await setHouseholdLimitInUI(page);
  await page.waitForFunction(() => !document.getElementById('settings').open);
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13');
  // From now on every other decode (the forced tick's) is parked too; then title 4's decode finishes.
  await page.evaluate(() => {
    window.__decodeHold.alt = null;
    window.__decodeHold.all = true;
  });
  await releaseDecodes(page);

  // The forced tick has picked its replacement and parked at its decode: nothing else can have cleared title 4.
  parked = [];
  for (let i = 0; i < 100 && !parked.length; i++) {
    await page.waitForTimeout(50);
    parked = await parkedAlts(page);
  }
  assert.equal(parked.length, 1, 'the forced tick is parked at its own decode');
  assert.ok([1, 2, 3, 6].includes(titleNo(parked[0])), `and it is an allowed poster (${parked[0]})`);
  assert.equal(await activeCount(page), 0, `title 4 was taken down after its decode (on screen: ${titleNo(await activeAlt(page))})`);
  assert.equal(await page.evaluate(() => document.body.classList.contains('poster-blocked')), true, 'the screen is blocked');

  await page.evaluate(() => (window.__decodeHold.all = false));
  await releaseDecodes(page);
  // The take-down after the decode is asserted above. What comes next is any allowed poster, not necessarily the one
  // that was parked: a revoked layer image can make that decode fail and the tick fall back to another cached poster.
  await waitForAllowedTitle(page);
  check(`PG-13 saved during title 4's decode: taken down once decoded (nothing on screen while the forced tick was held); then an allowed poster (${titleNo(await activeAlt(page))})`);
});

// 19. C6I1 (D29): importing settings in the dialog, and Cancel, never put an above-limit poster on screen. PG-13 is
//    saved; the dialog imports a file that pins title 4 (R) WITHOUT saving. A live preview keeps the saved pin and
//    the saved limit, so refreshes with the dialog open never draw title 4, and Cancel leaves nothing above the limit.
contentCase('19 C6I1 import an unsaved pin, refresh, Cancel', { settings: seed({ maxContentRating: 'PG-13' }) }, async ({ page, app }) => {
  await recordActiveAlts(page);
  await page.goto(app.url);
  await posterShown(page);
  await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
  await page.waitForSelector('#settings[open]');
  await page.setInputFiles('#import-file', { name: 'pin.json', mimeType: 'application/json', buffer: Buffer.from('{"staticRatingKey":"4"}') });
  await page.waitForFunction(() => document.getElementById('pinned-title').textContent !== 'none'); // the form took the import
  assert.equal((await storedSettings(page)).staticRatingKey || '', '', 'nothing was saved');
  for (let i = 0; i < 12; i++) await showNext(page); // refresh = a forced tick, with the dialog open
  let ever = (await everActive(page)).map(titleNo);
  assert.deepEqual([...new Set(ever)].filter((t) => ![1, 2, 3, 6].includes(t)), [], `dialog open after the import: only titles within PG-13 were drawn: ${[...new Set(ever)].sort()}`);
  assert.ok([1, 2, 3, 6].includes(titleNo(await activeAlt(page))), `an allowed poster is on screen (${titleNo(await activeAlt(page))})`);

  await page.click('#settings-cancel');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  await page.waitForTimeout(500);
  const after = titleNo(await activeAlt(page));
  assert.ok([1, 2, 3, 6].includes(after), `after Cancel an allowed poster is on screen (on screen: ${after})`);
  for (let i = 0; i < 10; i++) await showNext(page);
  ever = (await everActive(page)).map(titleNo);
  assert.deepEqual([...new Set(ever)].filter((t) => ![1, 2, 3, 6].includes(t)), [], `after Cancel too: ${[...new Set(ever)].sort()}`);
  const saved = await storedSettings(page);
  assert.equal(saved.maxContentRating, 'PG-13');
  assert.equal(saved.staticRatingKey || '', '', 'no pin was saved');
  check(`unsaved import of a pin on title 4: 22 refreshes drew only ${[...new Set(ever)].sort()}; Cancel left an allowed poster; nothing saved`);
});

// 20. C7I1 (D35): the dialog keeps the PENDING pin that an import set, so Save stores it (a pin is exempt from the
//    limit, D32), while the live preview still draws only the SAVED pin: import then Cancel leaves the saved pin alone
//    and draws nothing above the limit; reopening the dialog shows the saved pin again, not the discarded import.
const importPin = (page) =>
  page.setInputFiles('#import-file', { name: 'pin.json', mimeType: 'application/json', buffer: Buffer.from('{"staticRatingKey":"4","staticTitle":"Popcorn Skies"}') });
const openSettings = async (page) => {
  await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
  await page.waitForSelector('#settings[open]');
};

contentCase('20 C7I1 import a pin, Cancel, then import and Save', { settings: seed({ maxContentRating: 'PG-13' }) }, async ({ page, app }) => {
  await recordActiveAlts(page);
  await page.goto(app.url);
  await posterShown(page);

  await openSettings(page);
  await importPin(page);
  await page.waitForFunction(() => document.getElementById('pinned-title').textContent === 'Popcorn Skies');
  for (let i = 0; i < 8; i++) await showNext(page); // refreshes with the dialog open and the import pending
  await page.click('#settings-cancel');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  await page.waitForTimeout(300);
  let saved = await storedSettings(page);
  assert.equal(saved.staticRatingKey || '', '', 'Cancel: the saved pin is unchanged (none)');
  assert.equal(saved.maxContentRating, 'PG-13');
  for (let i = 0; i < 8; i++) await showNext(page);
  const ever = (await everActive(page)).map(titleNo);
  assert.deepEqual([...new Set(ever)].filter((t) => ![1, 2, 3, 6].includes(t)), [], `import + Cancel: only titles within PG-13 were drawn: ${[...new Set(ever)].sort()}`);
  assert.ok([1, 2, 3, 6].includes(titleNo(await activeAlt(page))), 'an allowed poster is on screen after Cancel');
  await openSettings(page);
  assert.equal(await page.textContent('#pinned-title'), 'none', 'the discarded import is not offered again');
  check(`import a pin then Cancel: saved pin unchanged, 16 refreshes drew only ${[...new Set(ever)].sort()}, reopened dialog shows no pin`);

  await importPin(page);
  await page.waitForFunction(() => document.getElementById('pinned-title').textContent === 'Popcorn Skies');
  await page.click('#settings-save');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  saved = await storedSettings(page);
  assert.equal(saved.staticRatingKey, '4', 'Save kept the imported pin');
  assert.equal(saved.staticTitle, 'Popcorn Skies');
  assert.equal(saved.maxContentRating, 'PG-13', 'and the limit');
  await waitForTitle(page, 4); // a pin is exempt from the limit (D32)
  for (let i = 0; i < 3; i++) {
    await showNext(page);
    assert.equal(titleNo(await activeAlt(page)), 4, 'the pinned title stays up');
  }
  await openSettings(page);
  assert.equal(await page.textContent('#pinned-title'), 'Popcorn Skies', 'reopened dialog shows the saved pin');
  await page.click('#unpin-btn');
  await page.click('#settings-save');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  assert.equal((await storedSettings(page)).staticRatingKey || '', '', 'Unpin then Save clears the pin');
  check('import a pin then Save: pin stored and shown (exempt from PG-13); reopen shows it; Unpin + Save clears it');
});

// 21. C7M1 (D35): a stricter limit saved during a crossfade also takes down the OUTGOING poster. crossfadeMs is 3 s;
//    the screen goes from title 4 (R) to an allowed title and PG-13 is saved mid-fade. The forced tick's image
//    download is held, so nothing else can reuse the layer: title 4's layer must be invisible at once (a fade would
//    still show it at ~0.9 opacity), while the new, allowed poster stays up.
contentCase('21 C7M1 limit saved mid-crossfade hides the outgoing poster', { settings: seed({ randomPoolSize: 4, crossfadeMs: 3000 }) }, async ({ page, app }) => {
  let hold = false;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route(/\/photo\/:\/transcode/, async (route) => {
    if (!hold) return route.continue();
    await gate;
    return route.continue();
  });
  await page.goto(app.url);
  await posterShown(page);
  await sampleUntil(page, [4]);
  await waitForTitle(page, 4);
  // Title 4 is itself fading in (3 s): let it finish, so the next crossfade starts from a fully visible poster.
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.poster-layer.active')).opacity === '1', null, { timeout: 8000 });
  await page.evaluate(async () => {
    // Forget every cached poster so the forced tick after the save has to download (and can be held).
    const cache = await caches.open('plex-posters-v1');
    for (const req of await cache.keys()) await cache.delete(req);
    localStorage.removeItem('plexPoster.posterIndex');
  });
  await openSettings(page);
  await page.check('#household-toggle'); // PG-13 in the form, not saved yet
  await page.evaluate(() => document.querySelector('[data-action="refresh"]').click()); // 4 -> another title, 3 s fade
  const t0 = Date.now();
  let next = 0;
  while (Date.now() - t0 < 10000 && ![1, 2, 3].includes(next)) {
    await page.waitForTimeout(25);
    next = titleNo(await activeAlt(page));
  }
  assert.ok([1, 2, 3].includes(next), `the refresh crossfaded to an allowed title (on screen: ${next})`);
  hold = true;
  const outgoing = await page.evaluate(() => {
    const img = document.querySelector('.poster-layer:not(.active)');
    return { id: img?.id, alt: img?.alt };
  });
  assert.equal(titleNo(outgoing.alt), 4, `the outgoing layer holds title 4 (${outgoing.alt})`);
  const opacity = (id) => page.evaluate((i) => Number(getComputedStyle(document.getElementById(i)).opacity), id);
  assert.ok((await opacity(outgoing.id)) > 0.05, 'title 4 is still visible, mid-fade, before the save');

  await page.click('#settings-save');
  const tSave = Date.now();
  let o = await opacity(outgoing.id);
  while (o !== 0 && Date.now() - tSave < 1000) {
    await page.waitForTimeout(20);
    o = await opacity(outgoing.id);
  }
  const took = Date.now() - tSave;
  assert.equal(o, 0, `title 4's layer is invisible after the save (opacity ${o} after ${took} ms)`);
  assert.ok(took <= 400, `and within ~100 ms of the save (took ${took} ms)`);
  assert.equal((await storedSettings(page)).maxContentRating, 'PG-13');
  assert.equal(await activeCount(page), 1, 'the new, allowed poster is still up');
  assert.equal(titleNo(await activeAlt(page)), next, 'and it is the one that was fading in');
  hold = false;
  release();
  await waitForAllowedTitle(page);
  check(`PG-13 saved 3 s-crossfade from title 4 to ${next}: title 4's layer invisible after ${took} ms; the new poster stayed up`);
});

// 22. C7M2 (D35): a poster seen online refreshes its stored rating in the cache index (a re-rated title must not keep
//    its old rating for the offline fallback). The index entry of title 4 (really R) is made to say PG, then the title
//    comes up again from the cache (no new download): the entry says R again.
contentCase('22 C7M2 a poster seen online refreshes its cached rating', { settings: seed({ randomPoolSize: 4 }) }, async ({ page, app }) => {
  await page.goto(app.url);
  await posterShown(page);
  await sampleUntil(page, [4]);
  await waitForTitle(page, 4);
  const rating4 = async () => (await index(page)).find((e) => e.ratingKey === '4')?.contentRating;
  assert.equal(await rating4(), 'R', 'title 4 is cached with its rating');
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('plexPoster.posterIndex')).map((e) => (e.ratingKey === '4' ? { ...e, contentRating: 'PG' } : e));
    localStorage.setItem('plexPoster.posterIndex', JSON.stringify(list));
  });
  assert.equal(await rating4(), 'PG', 'the stored rating is now stale');
  await sampleUntil(page, [4]); // title 4 again, served from the cache
  await waitForTitle(page, 4);
  let r = await rating4();
  for (let i = 0; i < 40 && r !== 'R'; i++) {
    await page.waitForTimeout(50);
    r = await rating4();
  }
  assert.equal(r, 'R', 'the stored rating follows the poster seen online');
  check('stale stored rating PG for title 4 -> shown online again -> the index says R');
});

// ---------- run ----------

const WORKERS = Number(process.env.E2E_CONTENT_WORKERS || 4);
if (process.env.E2E_CONTENT_ONLY) {
  const only = new RegExp(process.env.E2E_CONTENT_ONLY);
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
