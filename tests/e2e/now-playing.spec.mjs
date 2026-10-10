// Playback progress bar and player label (R-NP-1), plus two must-fixes this phase owns that live on the
// now-playing path: K18 (a refused /status/sessions must not stop rotation) and C8M1 (a failed playback poll
// must not make decide() ask for /status/sessions a second time in the same tick).
//
// Every case runs against its own mock Plex (serveArgs: []) and names pixelShift: false (convention 7): the bar
// is measured against the poster window, which pixel shift would move.

import assert from 'node:assert/strict';
import { withApp } from './lib.mjs';

const cases = [];
const npCase = (name, opts, fn) => cases.push({ name, opts: { serveArgs: [], ...opts }, fn });
const check = (name) => console.log(`  ok  ${name}`);

const seed = (extra = {}) => (app) => ({
  plexToken: 'demo-token',
  serverUrl: `http://127.0.0.1:${app.mockPort}`,
  libraryKey: '1',
  rotateSeconds: 3600,
  showNowPlaying: true,
  nowPlayingPollSeconds: 5,
  pixelShift: false,
  ...extra,
});

const POLL_MS = 5000;
const activeAlt = (page) => page.evaluate(() => document.querySelector('.poster-layer.active')?.alt || '');
const posterShown = (page) => page.waitForFunction(() => [...document.querySelectorAll('.poster-layer.active')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 });
const ratio = (page) =>
  page.evaluate(() => {
    const p = document.getElementById('progress').getBoundingClientRect();
    const b = document.getElementById('poster-box').getBoundingClientRect();
    return p.width / b.width;
  });
const progressHidden = (page) => page.evaluate(() => document.getElementById('progress').hidden);
const sessionRequests = async (mock) => (await mock.get('log')).requests.filter((r) => r.startsWith('/status/sessions')).length;

/** Polls (real time) until fn() returns truthy; fails after `ms`. */
async function until(what, fn, ms = 20000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${what} did not happen within ${ms} ms (last: ${last})`);
}
const near = (actual, want, tol, what) => assert.ok(Math.abs(actual - want) <= tol, `${what}: ${actual} not within ${tol} of ${want}`);

// 1. Mock item 3 at 600 s of 6000 s: 10 %, then 20 % after the next poll; inside #stage, 3 px, on the window's bottom edge.
npCase('1 progress bar follows viewOffset', { settings: seed() }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 600000, duration: 6000000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the bar', () => page.isVisible('#progress'));
  near(await ratio(page), 0.1, 0.01, 'at 600 s of 6000 s');

  const geometry = await page.evaluate(() => {
    const p = document.getElementById('progress');
    const r = p.getBoundingClientRect();
    const b = document.getElementById('poster-box').getBoundingClientRect();
    return { inStage: document.getElementById('stage').contains(p), height: r.height, bottomGap: Math.abs(r.bottom - b.bottom), leftGap: Math.abs(r.left - b.left) };
  });
  assert.equal(geometry.inStage, true, 'the bar is inside #stage');
  near(geometry.height, 3, 0.01, 'the bar is 3 px high');
  assert.ok(geometry.bottomGap <= 1 && geometry.leftGap <= 1, `the bar sits on the poster window's bottom-left corner: ${JSON.stringify(geometry)}`);
  check('600 s of 6000 s: #progress is 10 % of the poster window, 3 px high, inside #stage, on the bottom edge');

  await mock.play(3, { offset: 1200000, duration: 6000000, player: 'Living Room' });
  await until('20 %', async () => Math.abs((await ratio(page)) - 0.2) <= 0.01, POLL_MS * 3);
  check('after the next poll with offset 1200000 the bar is 20 %');
});

// 2. The bar is advanced by ONE linear CSS transition between polls, not a timer: it moves with no poll, and the
//    element carries a running transition whose duration is the remaining time.
npCase('2 one linear transition between polls', { settings: seed({ nowPlayingPollSeconds: 60 }) }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 10000, duration: 100000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the bar', () => page.isVisible('#progress'));
  const first = await ratio(page);
  await page.waitForTimeout(2000);
  const second = await ratio(page);
  assert.ok(second > first + 0.015, `the bar moved between polls without a request (${first} -> ${second})`);
  const style = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('progress'));
    return { timing: cs.transitionTimingFunction, duration: cs.transitionDuration, running: document.getElementById('progress').getAnimations().length };
  });
  assert.equal(style.timing, 'linear');
  assert.equal(style.running, 1, 'exactly one running animation');
  const seconds = parseFloat(style.duration);
  assert.ok(seconds > 60 && seconds <= 90, `the transition lasts the remaining time (90 s at the start): ${style.duration}`);
  check(`the bar moved ${(first * 100).toFixed(1)} % -> ${(second * 100).toFixed(1)} % with one linear transition of ${style.duration}`);
});

// 3. A paused session freezes the bar.
npCase('3 paused freezes the bar', { settings: seed() }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 50000, duration: 100000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the bar', () => page.isVisible('#progress'));
  const a = await ratio(page);
  await page.waitForTimeout(1500);
  const b = await ratio(page);
  assert.ok(b > a + 0.005, `playing: the bar advances (${a} -> ${b})`);

  const before = await sessionRequests(mock);
  await mock.play(3, { offset: 60000, duration: 100000, player: 'Living Room', state: 'paused' });
  await until('a poll after pausing', async () => (await sessionRequests(mock)) > before, POLL_MS * 3);
  await page.waitForTimeout(400);
  const p1 = await ratio(page);
  near(p1, 0.6, 0.01, 'paused at 60 s of 100 s');
  await page.waitForTimeout(2000);
  const p2 = await ratio(page);
  assert.ok(Math.abs(p2 - p1) < 0.001, `paused: the bar stays put (${p1} -> ${p2})`);
  assert.equal(await page.isVisible('#progress'), true, 'a paused session still shows its bar');
  check('state=paused: the bar sits at 60 % and does not move');
});

// 4. mock.stop() removes the bar; the poster rotates again.
npCase('4 stop removes the bar', { settings: seed() }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 600000, duration: 6000000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the bar', () => page.isVisible('#progress'));
  await mock.stop();
  await until('the bar to go', async () => (await progressHidden(page)) === true, POLL_MS * 3);
  await until('the label to go', async () => (await page.isVisible('#player-label')) === false, 2000);
  check('mock.stop(): #progress is removed after the next poll');
});

// 5. showProgress:false hides it.
npCase('5 showProgress false hides the bar', { settings: seed({ showProgress: false }) }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 600000, duration: 6000000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the now-playing poster', async () => (await activeAlt(page)).includes('Velvet Curtain'));
  const before = await sessionRequests(mock);
  await until('a second poll', async () => (await sessionRequests(mock)) > before, POLL_MS * 3);
  assert.equal(await progressHidden(page), true, '#progress stays hidden');
  assert.equal(await page.isVisible('#progress'), false);
  check('showProgress:false: no bar although a session is playing');
});

// 6. showPlayer:true shows "Playing in Living Room"; the default hides it.
npCase('6 player label', { settings: seed({ showPlayer: true }) }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 600000, duration: 6000000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the label', () => page.isVisible('#player-label'));
  assert.equal((await page.textContent('#player-label')).trim(), 'Playing in Living Room');
  check('showPlayer:true: "Playing in Living Room"');
});
npCase('7 player label is off by default', { settings: seed() }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 600000, duration: 6000000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the bar', () => page.isVisible('#progress'));
  assert.equal(await page.isVisible('#player-label'), false, 'default: no label');
  assert.equal(await page.evaluate(() => (document.getElementById('player-label').textContent || '').trim()), '');
  check('default: the player label is hidden');
});

// 8. The filter wins: a title above the limit that is playing shows neither a poster nor a bar.
npCase('8 an above-limit title playing shows no bar', { settings: seed({ maxContentRating: 'PG-13', showPlayer: true }) }, async ({ page, app, mock }) => {
  await mock.play(4, { offset: 600000, duration: 6000000, player: 'Living Room' }); // title 4 is R
  await page.goto(app.url);
  await posterShown(page);
  const before = await sessionRequests(mock);
  await until('a second poll', async () => (await sessionRequests(mock)) > before, POLL_MS * 3);
  assert.equal(await progressHidden(page), true, 'no bar for a blocked title');
  assert.equal(await page.isVisible('#player-label'), false, 'no player label for a blocked title');
  assert.ok(!(await activeAlt(page)).includes('Popcorn Skies'), 'the blocked poster is not shown');
  check('R title playing under PG-13: no poster, no bar, no label');
});

// 9. K18 (D24): a 401/403 on /status/sessions must not stop poster rotation.
for (const [label, extra] of [['engine fetch only', {}], ['sleep poll also asks', { idleSleepHours: 1 }]]) {
  for (const status of [401, 403]) {
    npCase(`9 K18 ${status} on sessions, ${label}`, { settings: seed(extra) }, async ({ page, app, mock }) => {
      await mock.post('sessions-status', { status });
      await page.goto(app.url);
      await posterShown(page);
      assert.equal(await page.isVisible('#empty'), false, 'no error card');
      const seen = new Set([await activeAlt(page)]);
      for (let i = 0; i < 12 && seen.size < 3; i++) {
        await page.evaluate(() => document.querySelector('[data-action="refresh"]').click());
        await page.waitForTimeout(400);
        seen.add(await activeAlt(page));
      }
      assert.ok(seen.size >= 3, `posters keep rotating while sessions are refused (${[...seen].join(' | ')})`);
      assert.equal(await page.isVisible('#empty'), false, 'still no error card');
      assert.ok((await sessionRequests(mock)) >= 1, 'sessions were asked for');
      assert.equal(await progressHidden(page), true);
      // A lifted refusal is picked up again by the normal poll.
      await mock.post('sessions-status', { status: 200 });
      await mock.play(3, { offset: 600000, duration: 6000000, player: 'Living Room' });
      await until('now playing once sessions are allowed again', async () => (await activeAlt(page)).includes('Velvet Curtain') && (await page.isVisible('#progress')), POLL_MS * 4);
      check(`${status} on /status/sessions (${label}): ${seen.size} different posters, no error card; playback shows once allowed`);
    });
  }
}

// 10. C8M1 (D28): with now-playing on, a failed playback poll costs ONE /status/sessions request per tick, not two.
for (const [label, status, extra] of [
  ['500', 500, {}],
  ['403', 403, {}],
]) {
  npCase(`10 C8M1 ${label} poll, one request per tick`, { settings: seed({ idleSleepHours: 1, ...extra }) }, async ({ page, app, mock }) => {
    await mock.post('sessions-status', { status });
    await page.goto(app.url);
    await until('the first tick to settle', async () => (await page.isVisible('#empty')) || (await page.evaluate(() => [...document.querySelectorAll('.poster-layer.active')].length > 0)));
    await page.waitForTimeout(500);
    for (let round = 0; round < 3; round++) {
      await mock.post('reset-stats');
      await page.evaluate(() => document.querySelector('[data-action="refresh"]').click());
      await page.waitForTimeout(1500); // shorter than the first retry delay, so only the forced tick runs
      const n = await sessionRequests(mock);
      assert.equal(n, 1, `forced tick ${round + 1} with ${status} on sessions: ${n} /status/sessions requests`);
    }
    check(`${label} on /status/sessions: a tick with a failed playback poll makes exactly one request (3 forced ticks)`);
  });
}

// 11. MCM3: only `playing` animates the bar; a buffering session is frozen like a paused one.
npCase('11 buffering freezes the bar', { settings: seed() }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 50000, duration: 100000, player: 'Living Room', state: 'buffering' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the bar', () => page.isVisible('#progress'));
  await page.waitForTimeout(300);
  const a = await ratio(page);
  near(a, 0.5, 0.01, 'buffering at 50 s of 100 s');
  await page.waitForTimeout(2000);
  const b = await ratio(page);
  assert.ok(Math.abs(b - a) < 0.001, `buffering: the bar stays put (${a} -> ${b})`);
  assert.equal(await page.evaluate(() => document.getElementById('progress').getAnimations().length), 0, 'no running transition');

  const before = await sessionRequests(mock);
  await mock.play(3, { offset: 60000, duration: 100000, player: 'Living Room', state: 'playing' });
  await until('a poll after buffering ends', async () => (await sessionRequests(mock)) > before, POLL_MS * 3);
  await page.waitForTimeout(400);
  const c = await ratio(page);
  await page.waitForTimeout(1500);
  assert.ok((await ratio(page)) > c + 0.005, 'playing again: the bar advances');
  check('state=buffering: the bar sits at 50 % with no running transition; state=playing animates it again');
});

// 12. MCM2: the Settings toggles for the bar and the label show in the live preview, Cancel undoes them, and after
//     Save they apply at once even while a tick is running (its /status/sessions answer is held back here).
npCase('12 progress and player toggles apply at once', { settings: seed({ showProgress: false, showPlayer: false }) }, async ({ page, app, mock }) => {
  await mock.play(3, { offset: 600000, duration: 6000000, player: 'Living Room' });
  await page.goto(app.url);
  await posterShown(page);
  await until('the now-playing poster', async () => (await activeAlt(page)).includes('Velvet Curtain'));
  assert.equal(await progressHidden(page), true, 'both off: no bar');
  const labelShown = () => page.isVisible('#player-label');
  const open = async () => {
    await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
    await page.waitForSelector('#settings[open]');
  };
  const closed = () => page.waitForFunction(() => !document.getElementById('settings').open);

  // Live preview: no Save, no tick.
  await open();
  await page.check('input[name="showProgress"]');
  await page.check('input[name="showPlayer"]');
  await until('the previewed bar', () => page.isVisible('#progress'), 2000);
  near(await ratio(page), 0.1, 0.01, 'previewed bar at 600 s of 6000 s');
  await until('the previewed label', labelShown, 2000);
  assert.equal((await page.textContent('#player-label')).trim(), 'Playing in Living Room');
  await page.click('#settings-cancel');
  await closed();
  await until('Cancel hides the bar', async () => (await progressHidden(page)) === true, 2000);
  assert.equal(await labelShown(), false, 'Cancel hides the label');
  check('toggling the bar and the label previews at once; Cancel undoes it');

  // Save while a tick is running: hold the next /status/sessions answer.
  let held = 0;
  const release = [];
  await page.route('**/status/sessions*', async (route) => {
    held++;
    await new Promise((r) => {
      release.push(r);
      setTimeout(r, 6000);
    });
    await route.continue().catch(() => {});
  });
  await page.evaluate(() => document.querySelector('[data-action="refresh"]').click()); // a tick, now stuck on the poll
  await until('a tick in flight', () => held > 0, 5000);
  await open();
  await page.check('input[name="showProgress"]');
  await page.check('input[name="showPlayer"]');
  await page.click('#settings-save');
  await closed();
  await until('the saved bar, tick still running', () => page.isVisible('#progress'), 1500);
  near(await ratio(page), 0.1, 0.02, 'saved bar');
  await until('the saved label, tick still running', labelShown, 1500);
  assert.equal(release.length > 0 && held > 0, true);

  await open();
  await page.uncheck('input[name="showProgress"]');
  await page.uncheck('input[name="showPlayer"]');
  await page.click('#settings-save');
  await closed();
  await until('the bar goes at once', async () => (await progressHidden(page)) === true, 1500);
  assert.equal(await labelShown(), false, 'the label goes at once');
  release.forEach((r) => r());
  check('Save with a tick running: the bar and the label appear, and go, at once');
});

// ---------- run ----------

const WORKERS = Number(process.env.E2E_NP_WORKERS || 3);
if (process.env.E2E_NP_ONLY) {
  const only = new RegExp(process.env.E2E_NP_ONLY);
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
