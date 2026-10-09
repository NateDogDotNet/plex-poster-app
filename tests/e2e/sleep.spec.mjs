// Sleep mode (R-PROT-1, D4): a black veil with the wake lock still held, playback wakes it, manual wake lasts 60 s.
// Local time: the fake clock's ISO strings below are wall-clock times in the browser's timezone.

import assert from 'node:assert/strict';
import { withApp } from './lib.mjs';

// Every case runs against its own mock Plex (serveArgs: []), so cases can run side by side: the whole spec
// has to fit run.mjs's 180 s per-spec limit.
const cases = [];
const sleepCase = (name, opts, fn) => cases.push({ name, opts: { serveArgs: [], ...opts }, fn });

const check = (name) => console.log(`  ok  ${name}`);
const INSIDE = '2026-01-05T03:00:00'; // inside the default 01:00-07:00 window
const OUTSIDE = '2026-01-05T12:00:00';
const POLL = 5; // nowPlayingPollSeconds (the minimum)

const seed = (extra = {}) => (app) => ({
  plexToken: 'demo-token',
  serverUrl: `http://127.0.0.1:${app.mockPort}`,
  libraryKey: '1',
  showNowPlaying: true,
  nowPlayingPollSeconds: POLL,
  rotateSeconds: 3600,
  sleepEnabled: true,
  ...extra,
});

const waitAsleep = (page, want = true, timeout = 15000) =>
  page.waitForFunction((w) => document.body.classList.contains('asleep') === w && document.getElementById('sleep-veil').hidden !== w, want, { timeout });
const isAsleep = (page) => page.evaluate(() => document.body.classList.contains('asleep'));
const posterShown = (page) => page.waitForFunction(() => [...document.querySelectorAll('.poster-layer.active')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 });
const lock = (page) => page.evaluate(() => ({ ...window.__wakeLock }));
const now = (page) => page.evaluate(() => Date.now());

/** Advance the fake clock in small steps, leaving real time for each poll's network round trip. */
async function advance(page, ms, step = 1000) {
  for (let t = 0; t < ms; t += step) {
    await page.clock.runFor(Math.min(step, ms - t));
    await page.waitForTimeout(30);
  }
}

/** Step the fake clock until `cond` holds, returning the simulated milliseconds it took. */
async function advanceUntil(page, cond, maxMs, step = 1000) {
  const t0 = await now(page);
  for (let t = 0; t <= maxMs; t += step) {
    if (await cond()) return (await now(page)) - t0;
    await advance(page, step, step);
  }
  assert.fail(`condition not met within ${maxMs} simulated ms`);
}

const watchRequests = (page) => {
  const seen = { transcode: [], sessions: 0 };
  page.on('request', (r) => {
    if (r.url().includes('/photo/:/transcode')) seen.transcode.push(r.url());
    if (r.url().includes('/status/sessions')) seen.sessions++;
  });
  return seen;
};

const diagnosticsRow = async (page, key) => {
  await page.evaluate(() => document.querySelector('[data-action="diagnostics"]').click());
  const text = await page.evaluate((k) => [...document.querySelectorAll('#diag-list dt')].find((dt) => dt.textContent === k)?.nextElementSibling?.textContent, key);
  await page.evaluate(() => document.getElementById('diag-close').click());
  return text;
};

// 1. Asleep inside the window: opaque black veil, controls hidden, wake lock held, no poster fetches, sessions still polled.
sleepCase('1-2 asleep in the window, playback wakes it', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  const seen = watchRequests(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(app.url);
  await waitAsleep(page);

  const veil = await page.evaluate(() => {
    const el = document.getElementById('sleep-veil');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { bg: cs.backgroundColor, opacity: cs.opacity, display: cs.display, visibility: cs.visibility, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, topId: top?.id };
  });
  assert.equal(veil.bg, 'rgb(0, 0, 0)');
  assert.equal(veil.opacity, '1');
  assert.notEqual(veil.display, 'none');
  assert.equal(veil.visibility, 'visible');
  assert.deepEqual([veil.w, veil.h], [veil.vw, veil.vh]);
  assert.equal(veil.topId, 'sleep-veil');
  assert.equal(await page.isVisible('#sleep-veil'), true);
  for (const sel of ['#controls', '#status', '#toast']) assert.equal(await page.isVisible(sel), false, `${sel} hidden`);
  check('asleep: #sleep-veil visible, opaque black, full screen; controls hidden');

  await page.waitForFunction(() => window.__wakeLock.held === 1, null, { timeout: 10000 });
  const before = await lock(page);
  await advance(page, 3 * POLL * 1000);
  const after = await lock(page);
  assert.equal(after.held, 1, 'the lock (a counter in the stub) is held once');
  assert.equal(after.releases, before.releases, 'sleeping released nothing');
  assert.equal(after.releases, 0);
  check('wake lock held === 1 and releases unchanged while asleep');

  assert.deepEqual(seen.transcode, [], 'no image request while asleep');
  assert.ok(seen.sessions >= 2, `/status/sessions still polled (${seen.sessions})`);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.poster-layer.active').length), 0, 'display.show never called');
  assert.deepEqual(errors, []);
  check(`no /photo/:/transcode request while asleep; ${seen.sessions} session polls`);

  assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (schedule)');
  assert.match((await diagnosticsRow(page, 'Local time')) || '', /\S/);
  assert.doesNotMatch((await diagnosticsRow(page, 'Local time')) || '', /Clock not set/);
  check('Diagnostics: Sleep: asleep (schedule), local time shown');

  // 2. Playback wakes the display within one poll interval and the poster appears; stopping sleeps again.
  await mock.play('3');
  const took = await advanceUntil(page, async () => !(await isAsleep(page)), (POLL + 2) * 1000);
  assert.ok(took <= (POLL + 1) * 1000, `woke after ${took} simulated ms (poll ${POLL}s)`);
  assert.equal(await page.isVisible('#sleep-veil'), false);
  await posterShown(page);
  assert.ok(seen.transcode.length >= 1, 'poster fetched on wake');
  check(`mock.play(): veil hidden after ${took} ms (<= one poll), poster shown`);
  assert.equal(await diagnosticsRow(page, 'Sleep'), 'awake');

  await mock.stop();
  await advanceUntil(page, async () => isAsleep(page), (POLL + 3) * 1000);
  await waitAsleep(page);
  assert.equal((await lock(page)).releases, 0);
  check('playback stops inside the window -> asleep again; wake lock never released');
});

// 3. wakeOnPlayback:false keeps the veil during the window; nothing is fetched and (case 20) sessions are not polled.
sleepCase('3 wakeOnPlayback false', { settings: seed({ wakeOnPlayback: false }), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.play('2');
  try {
    const seen = watchRequests(page);
    await page.goto(app.url);
    await waitAsleep(page);
    await advance(page, 4 * POLL * 1000);
    assert.equal(await isAsleep(page), true);
    assert.deepEqual(seen.transcode, []);
    assert.equal(seen.sessions, 0, 'wakeOnPlayback off and no idle sleep: the answer cannot matter, so it is not asked');
    check('wakeOnPlayback:false: veil stays up while playing during the window; /status/sessions not polled');
  } finally {
    await mock.stop();
  }
});

// 4. Playback already running when the window opens (awake -> window starts -> wakes straight away).
sleepCase('4 window opens during playback', { settings: seed(), clock: { time: '2026-01-05T00:59:30' } }, async ({ page, app, mock }) => {
  await mock.play('4');
  try {
    await page.goto(app.url);
    await posterShown(page);
    assert.equal(await isAsleep(page), false);
    await advance(page, 40_000, 2000); // 01:00 passes
    assert.equal(await isAsleep(page), false, 'playback keeps the display awake in the window');
    await mock.stop();
    await advanceUntil(page, async () => isAsleep(page), (POLL + 3) * 1000);
    check('window opens during playback: stays awake, sleeps when playback stops');
  } finally {
    await mock.stop();
  }
});

// 5. Idle sleep: no playback for 61 simulated minutes with idleSleepHours:1 (outside any schedule).
sleepCase('5 idle sleep', { settings: seed({ sleepEnabled: false, idleSleepHours: 1 }), clock: { time: OUTSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await posterShown(page);
  await page.clock.runFor(59 * 60 * 1000);
  await page.waitForTimeout(200);
  assert.equal(await isAsleep(page), false, 'awake at 59 min');
  await page.clock.runFor(2 * 60 * 1000);
  await waitAsleep(page);
  assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (idle)');
  assert.equal((await lock(page)).releases, 0);
  check('idle sleep: awake at 59 min, asleep at 61 min without playback; Sleep: asleep (idle)');

  await mock.play('5');
  try {
    await advanceUntil(page, async () => !(await isAsleep(page)), (POLL + 2) * 1000);
    await posterShown(page);
    await advance(page, 10_000, 2000);
    assert.equal(await isAsleep(page), false, 'playback restarts the idle clock');
    check('idle sleep: playback wakes the display and it stays awake');
  } finally {
    await mock.stop();
  }
});

// 5b. The idle clock counts from the LAST poll that saw playback, not from boot: playback that runs past the
// original deadline must not leave the display asleep the moment it stops.
sleepCase('5b idle clock counts from the last playback', { settings: seed({ sleepEnabled: false, idleSleepHours: 1 }), clock: { time: OUTSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await posterShown(page);
  await page.clock.runFor(50 * 60 * 1000);
  await page.waitForTimeout(200);
  assert.equal(await isAsleep(page), false, 'awake at 50 min');
  await mock.play('5');
  try {
    await advance(page, 3 * POLL * 1000, 1000);
    await posterShown(page); // the session was seen
    await advance(page, 15 * 60 * 1000, 3 * POLL * 1000); // plays until ~66 min, past the original 60 min deadline
    assert.equal(await isAsleep(page), false, 'awake while playing past the 60 min deadline');
  } finally {
    await mock.stop();
  }
  await advance(page, 3 * POLL * 1000, 1000); // a few polls see the session end
  assert.equal(await isAsleep(page), false, 'awake right after playback ends (idle counts from the last playback)');
  await page.clock.runFor(50 * 60 * 1000);
  await page.waitForTimeout(200);
  assert.equal(await isAsleep(page), false, 'still awake 50 min after playback ended');
  await page.clock.runFor(12 * 60 * 1000);
  await waitAsleep(page);
  assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (idle)');
  check('idle sleep: playback past the original deadline; awake after it stops, asleep one idle hour after the last playback');
});

// 6. A key press wakes for 60 s and does not trigger the shortcut; then it sleeps again.
sleepCase('6 key press and mouse press wake', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await page.keyboard.press('s');
  await waitAsleep(page, false);
  assert.equal(await page.evaluate(() => document.getElementById('settings').open), false, 'the key press did not open Settings');
  await advance(page, 50_000, 5000);
  assert.equal(await isAsleep(page), false, 'still awake at 50 s');
  await advance(page, 12_000, 2000);
  await waitAsleep(page);
  assert.equal((await lock(page)).releases, 0);
  check('key press: wakes (Settings not opened), awake until 60 s, then asleep again');

  // A tap/click on the veil wakes too, and the control under the finger is not activated.
  await page.addStyleTag({ content: 'body.asleep .controls { visibility: visible !important; } .controls { opacity: 1 !important; pointer-events: auto !important; }' });
  const box = await page.locator('#controls [data-action="settings"]').boundingBox();
  assert.ok(box, 'settings button has a box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitAsleep(page, false);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById('settings').open), false, 'the tap did not open Settings');
  check('pointer press on the veil wakes without activating the control under it');
});

// 6b. A touch tap wakes, and the click that follows it must not land on the control the veil uncovered.
// (Touch: the click is hit-tested when the finger lifts, after the veil is gone; a mouse click is not.)
sleepCase('6b touch tap wakes', { settings: seed(), clock: { time: INSIDE }, hasTouch: true }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  // Make the controls tappable once awake (they are normally revealed by a first tap), so a leaked click would act.
  await page.addStyleTag({ content: '.controls { opacity: 1 !important; pointer-events: auto !important; }' });
  const probe = await page.evaluate(() => {
    const r = document.querySelector('#controls [data-action="settings"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.touchscreen.tap(probe.x, probe.y);
  await waitAsleep(page, false);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.getElementById('settings').open), false, 'the tap did not open Settings');
  assert.equal(await isAsleep(page), false, 'the tap woke the display');
  // The swallow is for that one click only: a second tap on the same control now works.
  await page.waitForTimeout(900);
  await page.touchscreen.tap(probe.x, probe.y);
  await page.waitForFunction(() => document.getElementById('settings').open, null, { timeout: 5000 });
  check('touch tap on the veil wakes; the control under the finger is not activated (one click swallowed, the next works)');
});

// 7. Offline start: the veil comes up with no network, shows no cached poster, and playback wakes it once Plex is back.
sleepCase('7 offline start', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await mock.down();
  try {
    const seen = watchRequests(page);
    await page.goto(app.url);
    await waitAsleep(page);
    await advance(page, 3 * POLL * 1000);
    assert.equal(await isAsleep(page), true);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.poster-layer.active').length), 0);
    assert.deepEqual(seen.transcode, []);
    await mock.up();
    await mock.play('6');
    await advanceUntil(page, async () => !(await isAsleep(page)), 60_000);
    await posterShown(page);
    check('offline start inside the window: veil up; after Plex returns, playback wakes it and shows the poster');
  } finally {
    await mock.up();
    await mock.stop();
  }
});

// 8. Settings saved while asleep: turning the schedule off lifts the veil for good and the lock is untouched.
sleepCase('8 settings saved asleep', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await page.keyboard.press('s'); // wakes
  await waitAsleep(page, false);
  await page.keyboard.press('s'); // opens Settings
  await page.waitForFunction(() => document.getElementById('settings').open);
  await page.uncheck('input[name="sleepEnabled"]');
  await page.click('#settings-save');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  await advance(page, 70_000, 5000);
  assert.equal(await isAsleep(page), false, 'no sleep after the schedule is turned off');
  const l = await lock(page);
  assert.deepEqual([l.held, l.releases], [1, 0]);
  check('settings saved (schedule off) after a manual wake: stays awake past 60 s, wake lock untouched');
});

// 9. A clock that is not set: the schedule does nothing, idle sleep still works, a clock change is handled.
sleepCase('9a clock not set', { settings: seed(), clock: { time: '1970-01-01T03:00:00' } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await posterShown(page);
  await advance(page, 5000);
  assert.equal(await isAsleep(page), false, 'no schedule sleep at 1970');
  assert.match((await diagnosticsRow(page, 'Local time')) || '', /Clock not set/);
  assert.equal(await diagnosticsRow(page, 'Sleep'), 'awake');
  check('1970 clock inside the window: does not sleep; Diagnostics says Clock not set');

  await page.clock.setSystemTime(new Date(INSIDE));
  await waitAsleep(page);
  assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (schedule)');
  assert.doesNotMatch((await diagnosticsRow(page, 'Local time')) || '', /Clock not set/);
  check('clock set into the window -> asleep (schedule)');
});

sleepCase('9b clock jump and idle', { settings: seed({ sleepEnabled: false, idleSleepHours: 1 }), clock: { time: '1970-01-01T03:00:00' } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await posterShown(page);
  await page.clock.runFor(30 * 60 * 1000);
  await page.waitForTimeout(200);
  await page.clock.setSystemTime(new Date(OUTSIDE)); // NTP arrives: 56 years in one step
  await advance(page, 5000);
  assert.equal(await isAsleep(page), false, 'a clock jump is not 56 years of idleness');
  await page.clock.runFor(31 * 60 * 1000);
  await waitAsleep(page);
  assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (idle)');
  check('1970 clock: idle sleep still works, and a clock jump does not trigger it early');
});

// ---------- r3 ----------

const ALLOW = { 'Access-Control-Allow-Origin': '*' };
const settingsOpen = (page) => page.evaluate(() => document.getElementById('settings').open);
const centreOf = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);

// 10. Blind taps: a second and third tap on the black screen must not reach the Pause button (Pause stops the
// playback poll, so playback could no longer wake the display).
sleepCase('10 double and triple tap while asleep', { settings: seed(), clock: { time: INSIDE }, hasTouch: true }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await page.addStyleTag({ content: '.controls { opacity: 1 !important; pointer-events: auto !important; }' }); // tappable once awake
  const pause = await centreOf(page, '#controls [data-action="pause"]');
  const pressed = () => page.evaluate(() => document.querySelector('[data-action="pause"]').getAttribute('aria-pressed'));
  for (const taps of [2, 3]) {
    for (let i = 0; i < taps; i++) {
      await page.touchscreen.tap(pause.x, pause.y);
      await page.waitForTimeout(500); // each tap is inside 800 ms of the previous one, the third is not inside 800 ms of the first
    }
    assert.equal(await isAsleep(page), false, `${taps} taps woke the display`);
    await page.waitForTimeout(900); // past the swallow window: clicks that were queued have all been delivered
    assert.equal(await pressed(), 'false', `${taps} taps left Pause off`);
    await advance(page, 62_000, 2000); // the manual wake lapses
    await waitAsleep(page);
    await mock.play('3');
    const took = await advanceUntil(page, async () => !(await isAsleep(page)), (POLL + 2) * 1000);
    assert.ok(took <= (POLL + 1) * 1000, `playback woke the display after ${took} ms`);
    await posterShown(page);
    await mock.stop();
    await advanceUntil(page, async () => isAsleep(page), (POLL + 3) * 1000);
  }
  assert.equal((await lock(page)).releases, 0);
  check('double and triple tap on the Pause button while asleep: Pause stays off, mock.play() still wakes the display');
});

// 11. A failed /status/sessions poll is never fatal and never decides playback.
sleepCase(
  '11 sessions 403 does not stop rotation',
  { settings: seed({ sleepEnabled: false, idleSleepHours: 1, showNowPlaying: false, rotateSeconds: 10 }), clock: { time: OUTSIDE } },
  async ({ page, app }) => {
    let refused = 0;
    await page.route('**/status/sessions*', (route) => (refused++, route.fulfill({ status: 403, headers: ALLOW, body: '{}' })));
    await page.goto(app.url);
    await posterShown(page);
    const seen = new Set([await diagnosticsRow(page, 'Poster')]);
    for (let i = 0; i < 8; i++) {
      await advance(page, 6000, 1000);
      seen.add(await diagnosticsRow(page, 'Poster'));
    }
    assert.ok(refused >= 3, `sessions was asked and refused (${refused})`);
    assert.ok(seen.size >= 3, `posters keep rotating with sessions refused (${[...seen].join(' | ')})`);
    assert.equal(await page.isVisible('#status'), false, 'no "Can\'t reach Plex"');
    assert.equal(await diagnosticsRow(page, 'Last error'), 'none');
    assert.equal(await isAsleep(page), false);
    check(`sessions 403 (idle sleep on, now playing off): ${seen.size} posters shown in 48 s, no error shown`);
  },
);

// showNowPlaying is off so each tick makes exactly one /status/sessions request: one aborted request is one failed poll.
sleepCase('11b one or two failed polls mid-playback keep the display awake', { settings: seed({ showNowPlaying: false }), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.play('3');
  try {
    let fail = 0;
    await page.route('**/status/sessions*', (route) => (fail > 0 ? (fail--, route.abort('connectionrefused')) : route.continue()));
    await page.goto(app.url);
    await posterShown(page);
    assert.equal(await isAsleep(page), false, 'a movie is playing inside the window');
    // The veil can drop and lift again within one tick (going to sleep polls at once), so watch the class, not just the state.
    await page.evaluate(() => {
      window.__everAsleep = false;
      new MutationObserver(() => (window.__everAsleep ||= document.body.classList.contains('asleep'))).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });
    // One failed poll, then successful ones (they reset the count), then two failed polls in a row: never three in a row.
    for (const burst of [1, 2]) {
      fail = burst;
      for (let t = 0; t < 4 * POLL * 1000; t += 500) {
        await advance(page, 500, 500);
        assert.equal(await isAsleep(page), false, `veil came up after ${t} ms of ${burst} failed poll(s)`);
      }
      assert.equal(fail, 0, `the ${burst} failure(s) happened`);
      await advance(page, 3 * POLL * 1000, 500); // successful polls in between
      assert.equal(await page.evaluate(() => window.__everAsleep), false, `the veil flashed after ${burst} failed poll(s)`);
    }
    await mock.stop();
    await advanceUntil(page, async () => isAsleep(page), 4 * POLL * 1000);
    check('one failed poll, then two in a row, mid-playback: veil stays down; it comes up after the playback really ends');
  } finally {
    await mock.stop();
  }
});

// 11d. K11 amended: a failed poll keeps the last playing state for at most 3 consecutive failed polls.
sleepCase('11d Plex outage mid-movie: the veil comes up within ~1.5 min', { settings: seed({ nowPlayingPollSeconds: 20, showNowPlaying: false }), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.play('3');
  try {
    await page.addInitScript(() => {
      window.__polls = 0; // awake /status/sessions requests (showNowPlaying is off, so one request is one playback poll)
      const realFetch = window.fetch;
      window.fetch = (...args) => (String(args[0]?.url ?? args[0]).includes('/status/sessions') && !document.body.classList.contains('asleep') && window.__polls++, realFetch(...args));
    });
    await page.goto(app.url);
    await posterShown(page);
    await page.waitForFunction(() => window.__wakeLock.held === 1, null, { timeout: 10000 });
    assert.equal(await isAsleep(page), false, 'a movie is playing inside the window');
    const before = await lock(page);
    // Polls made between the outage starting and the veil going up (the poll that going to sleep triggers is made asleep and not counted).
    const pollsBefore = await page.evaluate(() => {
      window.__pollsAtVeil = -1;
      new MutationObserver(() => document.body.classList.contains('asleep') && window.__pollsAtVeil < 0 && (window.__pollsAtVeil = window.__polls)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      return window.__polls;
    });
    await mock.down();
    const took = await advanceUntil(page, async () => isAsleep(page), 120_000);
    assert.ok(took <= 90_000, `veil came up ${took} simulated ms after the outage began`);
    const pollsAtVeil = (await page.evaluate(() => window.__pollsAtVeil)) - pollsBefore;
    assert.equal(pollsAtVeil, 3, `up on the third failed poll in a row, not before or after (${pollsAtVeil} polls)`);
    await waitAsleep(page);
    await advance(page, 30_000, 1000); // still down: stays asleep
    assert.equal(await isAsleep(page), true);
    const after = await lock(page);
    assert.equal(after.held, 1, 'wake lock still held');
    assert.equal(after.releases, before.releases, 'nothing released');
    await mock.up();
    await mock.play('3');
    await advanceUntil(page, async () => !(await isAsleep(page)), 60_000);
    check(`Plex down mid-movie (poll 20 s): veil up ${took} ms after the outage began, lock held (${after.held}, releases ${after.releases}); the movie wakes it again once Plex is back`);
  } finally {
    await mock.up();
    await mock.stop();
  }
});

sleepCase(
  '11c failed polls do not count as playback',
  { settings: seed({ sleepEnabled: false, idleSleepHours: 1, showNowPlaying: false, nowPlayingPollSeconds: 600, rotateSeconds: 3600 }), clock: { time: OUTSIDE } },
  async ({ page, app }) => {
    let refused = 0;
    await page.route('**/status/sessions*', (route) => (refused++, route.fulfill({ status: 500, headers: ALLOW, body: 'boom' })));
    await page.goto(app.url);
    await posterShown(page);
    for (let i = 0; i < 5; i++) {
      await page.clock.fastForward(10 * 60 * 1000); // one poll per jump
      await page.waitForTimeout(200);
    }
    await page.clock.fastForward(9 * 60 * 1000);
    await page.waitForTimeout(200);
    assert.equal(await isAsleep(page), false, 'awake at 59 min');
    await page.clock.fastForward(2 * 60 * 1000);
    await waitAsleep(page);
    assert.ok(refused >= 4, `polled and failed (${refused})`);
    check('every poll failing (HTTP 500) for 61 min: idle sleep still starts (a failed poll is not playback)');
  },
);

// 12. Input inside an open dialog is never swallowed, and activity keeps a manual wake going.
sleepCase('12 Settings stays usable', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await page.keyboard.press('s'); // wakes
  await waitAsleep(page, false);
  await page.keyboard.press('s'); // opens Settings
  await page.waitForFunction(() => document.getElementById('settings').open);
  // 70 s with only pointer movement, then 70 s with only key presses: each keeps the manual wake going.
  for (const kind of ['pointer', 'key']) {
    for (let i = 1; i <= 70; i++) {
      await advance(page, 1000, 1000);
      assert.equal(await isAsleep(page), false, `awake ${i} s into the ${kind} activity in Settings`);
      if (i % 4 === 0) await (kind === 'pointer' ? page.mouse.move(120 + i, 240) : page.keyboard.press('Shift'));
    }
  }
  const box = 'input[name="wakeOnPlayback"]';
  const before = await page.isChecked(box);
  await page.click(box);
  assert.equal(await page.isChecked(box), !before, 'the checkbox click toggled');
  check('70 s of pointer activity, then 70 s of key presses, in Settings: the display stays awake; a checkbox click toggles');

  await advance(page, 62_000, 2000); // no activity: the veil comes back behind the open dialog
  await waitAsleep(page);
  assert.equal(await settingsOpen(page), true);
  await page.click(box);
  assert.equal(await page.isChecked(box), before, 'a click on the dialog behind the returned veil is not swallowed');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('settings').open, null, { timeout: 5000 });
  check('veil back behind the open dialog: the next click and key press in the dialog act');
});

// 12b. With the veil back behind an open dialog, the FIRST input aimed at the dialog acts: a press on a control focuses it, a key press reaches it.
sleepCase('12b first input in a dialog behind the veil is not swallowed', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await page.keyboard.press('s'); // wakes
  await waitAsleep(page, false);
  await page.keyboard.press('s'); // opens Settings
  await page.waitForFunction(() => document.getElementById('settings').open);
  await advance(page, 62_000, 2000); // no activity: the veil comes back behind the open dialog
  await waitAsleep(page);
  assert.equal(await settingsOpen(page), true);
  const box = 'input[name="wakeOnPlayback"]';
  await page.focus('#settings-save'); // focus is inside the dialog but not on the box
  assert.notEqual(await page.evaluate(() => document.activeElement?.name), 'wakeOnPlayback');
  await page.locator(box).scrollIntoViewIfNeeded();
  const at = await page.locator(box).boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down(); // first input while asleep: a pointer press on a focusable control in the dialog
  const focused = await page.evaluate(() => document.activeElement?.name);
  await page.mouse.up();
  assert.equal(focused, 'wakeOnPlayback', 'the first press on the checkbox behind the veil focuses it');
  assert.equal(await isAsleep(page), false, 'and wakes the display');

  await advance(page, 62_000, 2000); // quiet again: veil back, dialog still open, focus still on the checkbox
  await waitAsleep(page);
  assert.equal(await settingsOpen(page), true);
  await page.focus(box); // focus inside the dialog, not through the press above
  await page.keyboard.press('Escape'); // first input while asleep: a key press aimed at the dialog
  await page.waitForFunction(() => !document.getElementById('settings').open, null, { timeout: 5000 });
  assert.equal(await isAsleep(page), false, 'and wakes the display');
  check('veil back behind the open dialog: the FIRST press focuses the control under it, and a first Escape closes the dialog');
});

// 13. Enabling idle sleep restarts the idle clock.
sleepCase(
  '13 enabling idle sleep restarts the clock',
  { settings: seed({ sleepEnabled: false, idleSleepHours: 0, showNowPlaying: false, rotateSeconds: 3600 }), clock: { time: OUTSIDE } },
  async ({ page, app, mock }) => {
    await mock.stop();
    await page.goto(app.url);
    await posterShown(page);
    await page.clock.fastForward(2 * 3600 * 1000); // two hours with no playback and no idle sleep configured (a jump: runFor would fire 7200 timers)
    await page.waitForTimeout(300);
    await page.keyboard.press('s');
    await page.waitForFunction(() => document.getElementById('settings').open);
    await page.fill('input[name="idleSleepHours"]', '1');
    await page.click('#settings-save');
    await page.waitForFunction(() => !document.getElementById('settings').open);
    await advance(page, 10_000, 1000);
    assert.equal(await isAsleep(page), false, 'saving idleSleepHours=1 does not black the screen at once');
    await page.clock.fastForward(58 * 60 * 1000);
    await page.waitForTimeout(300);
    assert.equal(await isAsleep(page), false, 'awake 58 min after the save');
    await page.clock.fastForward(3 * 60 * 1000);
    await waitAsleep(page);
    assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (idle)');
    check('idleSleepHours 0 -> 1 saved after 2 h: awake at save and at 58 min, asleep (idle) an hour after the save');
  },
);

// 14. While asleep, an outage must not delay the playback wake by more than about one poll.
sleepCase('14 playback wake after an outage', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await mock.down();
  await advance(page, 180_000, 1000); // a 3 minute Plex restart
  assert.equal(await isAsleep(page), true);
  await mock.up();
  await mock.play('6');
  try {
    const took = await advanceUntil(page, async () => !(await isAsleep(page)), 60_000);
    assert.ok(took <= (POLL + 2) * 1000, `woke ${took} simulated ms after Plex came back (poll ${POLL}s)`);
    await posterShown(page);
    check(`3 min outage while asleep, then mock.play(): awake ${took} ms after Plex returned`);
  } finally {
    await mock.stop();
  }
});

// 15. One sessions request per tick.
sleepCase('15 one sessions request per tick', { settings: seed(), clock: { time: OUTSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  const seen = watchRequests(page);
  await page.goto(app.url);
  await posterShown(page);
  await advance(page, 3000, 1000);
  const before = seen.sessions;
  await advance(page, 10 * POLL * 1000, 1000); // about ten ticks
  const polls = seen.sessions - before;
  assert.ok(polls >= 8 && polls <= 11, `${polls} sessions requests in ten ticks`);
  check(`awake, sleep configured, now playing on: ${polls} sessions requests in 10 ticks (one each)`);
});

// 16. Going to sleep or waking while paused starts no tick (the poster must not change under a pause).
sleepCase('16 no tick on a transition while paused', { settings: seed(), clock: { time: '2026-01-05T00:59:30' } }, async ({ page, app, mock }) => {
  await mock.stop();
  const seen = watchRequests(page);
  await page.goto(app.url);
  await posterShown(page);
  await page.keyboard.press('p');
  await page.waitForFunction(() => document.querySelector('[data-action="pause"]').getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(400);
  const base = { sessions: seen.sessions, images: seen.transcode.length };
  const same = (what) => assert.deepEqual({ sessions: seen.sessions, images: seen.transcode.length }, base, what);
  await advance(page, 40_000, 2000); // 01:00 passes
  await waitAsleep(page);
  await page.waitForTimeout(500);
  same('no request when the display went to sleep while paused');
  await page.keyboard.press('a'); // any key wakes
  await waitAsleep(page, false);
  await page.waitForTimeout(500);
  same('no request when it woke while paused');
  check('paused: sleeping and waking make no sessions or image request');
});

// 17. No cached poster is drawn while asleep (a Plex outage inside the window).
sleepCase(
  '17 no cached poster while asleep',
  { settings: seed({ rotateSeconds: 10 }), clock: { time: '2026-01-05T00:58:00' } },
  async ({ page, app, mock }) => {
    await mock.stop();
    await page.goto(app.url);
    await posterShown(page);
    await advanceUntil(page, async () => Number(await diagnosticsRow(page, 'Cached posters')) >= 2, 40_000, 2000); // two posters cached
    await mock.down();
    await advanceUntil(page, async () => isAsleep(page), 150_000, 2000);
    await waitAsleep(page);
    const shown = async () => ({
      poster: await diagnosticsRow(page, 'Poster'),
      reason: await diagnosticsRow(page, 'Reason'),
      layers: await page.evaluate(() => [...document.querySelectorAll('.poster-layer.active')].map((i) => i.src)),
    });
    const atSleep = await shown();
    await advance(page, 60_000, 2000); // six rotation intervals, Plex still down
    assert.equal(await isAsleep(page), true);
    assert.deepEqual(await shown(), atSleep, 'nothing was drawn, and nothing recorded as shown, while asleep');
    check(`Plex down inside the window with 2+ cached posters: nothing drawn while asleep (${atSleep.poster})`);
  },
);

// 18. The veil is hidden from assistive tech, the page under it is inert, top-layer dialogs stay usable.
sleepCase('18 veil semantics', { settings: seed(), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  const state = () => page.evaluate(() => ({ hidden: document.getElementById('sleep-veil').getAttribute('aria-hidden'), inert: document.getElementById('app').inert }));
  assert.deepEqual(await state(), { hidden: 'true', inert: true });
  await page.evaluate(() => document.querySelector('[data-action="diagnostics"]').click());
  assert.equal(await page.evaluate(() => document.getElementById('diagnostics').open), true);
  await page.click('#diag-close'); // a real pointer press inside the open dialog
  assert.equal(await page.evaluate(() => document.getElementById('diagnostics').open), false, 'the dialog above the veil took the click');
  await page.keyboard.press('a');
  await waitAsleep(page, false);
  assert.deepEqual(await state(), { hidden: 'true', inert: false });
  check('veil aria-hidden="true"; #app inert while asleep and not after; a dialog above the veil takes clicks');
});

// ---------- r7 ----------

// 19. A clock step must not re-shift a timestamp written after the step (C6I1). The step moves Date but not
// performance.now(), and nothing runs between it and the key press (the fake clock only moves when told to), so
// the press writes its timestamp on the new clock before the 1 s evaluateSleep() timer can see the step.
sleepCase('19a idle clock: step, then a write in the same second', { settings: seed({ sleepEnabled: false, idleSleepHours: 1, showNowPlaying: false }), clock: { time: '1970-01-01T03:00:00' } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await posterShown(page);
  await page.clock.runFor(30 * 60 * 1000);
  await page.waitForTimeout(200);
  await page.clock.setSystemTime(new Date(OUTSIDE)); // NTP arrives: 56 years in one step
  await page.keyboard.press('o'); // rotate: applySettings() stamps lastPlaybackAt (a save restarts the idle clock)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('plexPoster.settings')).rotation === 90);
  await page.waitForTimeout(300);
  await page.clock.fastForward(59 * 60 * 1000);
  await page.waitForTimeout(300);
  assert.equal(await isAsleep(page), false, 'awake 59 min after the write');
  await page.clock.fastForward(3 * 60 * 1000);
  await waitAsleep(page);
  assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (idle)');
  check('1970 clock stepped to 2026, key press in the same second: idle sleep starts an hour after it, not never');
});

sleepCase('19b manual wake: step, then a key press in the same second', { settings: seed({ showNowPlaying: false }), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await page.waitForTimeout(200);
  await page.clock.setSystemTime(new Date('2026-01-05T04:00:00')); // +1 h, still inside the window
  await page.keyboard.press('a'); // wakes for 60 s
  await waitAsleep(page, false);
  await advance(page, 50_000, 5000);
  assert.equal(await isAsleep(page), false, 'still awake at 50 s');
  await advance(page, 15_000, 1000);
  await waitAsleep(page);
  check('clock stepped +1 h while asleep, key press in the same second: the manual wake lasts about 60 s, not an hour');
});

// 20. Sessions are polled only when the answer can matter (C6M1).
sleepCase('20 no sessions polling when it cannot matter', { settings: seed({ wakeOnPlayback: false, idleSleepHours: 0, showNowPlaying: false }), clock: { time: '2026-01-05T00:59:30' } }, async ({ page, app, mock }) => {
  await mock.play('2'); // something is playing, to be sure the answer would have been interesting
  try {
    const seen = watchRequests(page);
    await page.goto(app.url);
    await posterShown(page);
    await advance(page, 6 * POLL * 1000, 1000); // awake: several poll periods
    assert.equal(seen.sessions, 0, 'no /status/sessions request while awake');
    await advance(page, 30_000, 1000); // 01:00 passes
    await waitAsleep(page);
    await advance(page, 6 * POLL * 1000, 1000); // asleep: several more
    assert.equal(await isAsleep(page), true, 'playback cannot wake it (wakeOnPlayback off)');
    assert.equal(seen.sessions, 0, 'no /status/sessions request while asleep');
    check('schedule on, wakeOnPlayback off, idle sleep off, now playing off: no /status/sessions request awake or asleep');
  } finally {
    await mock.stop();
  }
});

// 21. A poster download already in flight when sleep starts is not drawn under the veil (C6M3).
sleepCase('21 in-flight poster fetch when sleep starts', { settings: seed({ showNowPlaying: false }), clock: { time: '2026-01-05T00:59:58' } }, async ({ page, app, mock }) => {
  await mock.stop();
  let held = null;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let hold = true;
  await page.route(/\/photo\/:\/transcode/, async (route) => {
    if (!hold) return route.continue();
    held = route;
    await gate;
    return route.continue();
  });
  await page.goto(app.url);
  for (let i = 0; i < 100 && !held; i++) await page.waitForTimeout(50); // the first tick's image request is parked
  assert.ok(held, 'the first poster download is in flight');
  await page.clock.runFor(4000); // 01:00:02: the window opens while it is parked
  await waitAsleep(page);
  hold = false;
  release();
  await page.waitForTimeout(800); // the download completes
  assert.equal(await page.evaluate(() => document.querySelectorAll('.poster-layer.active').length), 0, 'nothing drawn under the veil');
  assert.equal(await diagnosticsRow(page, 'Poster'), '—', 'and nothing recorded as shown');
  assert.equal(await isAsleep(page), true);
  await page.keyboard.press('a'); // wake
  await waitAsleep(page, false);
  await posterShown(page);
  assert.notEqual(await diagnosticsRow(page, 'Poster'), '—');
  check('poster download in flight when the window opens: not drawn under the veil; the next wake shows a poster normally');
});

// ---------- r8 ----------

// 22. The other two write sites of the clock-step fix: a playback poll that sees a movie (22a) and a pointer move
// during a manual wake (22b). In each, the step moves Date but not performance.now(), and the fake clock only
// moves when told to, so the write lands on the new clock before the 1 s evaluateSleep() timer sees the step.

// 22a. The parked sessions request is answered after the step, so that poll stamps lastPlaybackAt on the new clock.
sleepCase('22a idle clock: step, then a poll that sees playback in the same second', { settings: seed({ sleepEnabled: false, idleSleepHours: 1, showNowPlaying: false }), clock: { time: OUTSIDE } }, async ({ page, app, mock }) => {
  await mock.play('3');
  try {
    let held = null;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let hold = false;
    await page.route('**/status/sessions*', async (route) => {
      if (!hold) return route.continue();
      held = route;
      await gate;
      return route.continue();
    });
    await page.goto(app.url);
    await posterShown(page);
    await advance(page, 3 * POLL * 1000, 1000); // polls see the movie
    hold = true;
    for (let i = 0; i < 30 && !held; i++) await advance(page, 1000, 1000); // the next poll's request is parked
    assert.ok(held, 'a playback poll is in flight');
    const before = await now(page);
    await page.clock.setSystemTime(new Date(before + 2 * 3600 * 1000)); // NTP arrives: +2 h in one step
    hold = false;
    release(); // the poll sees the movie and stamps lastPlaybackAt on the new clock
    await page.waitForTimeout(500);
    assert.equal(await isAsleep(page), false);
    await mock.stop(); // the last playback was seen just now
    await page.clock.fastForward(59 * 60 * 1000);
    await page.waitForTimeout(300);
    assert.equal(await isAsleep(page), false, 'awake 59 min after the last playback');
    await page.clock.fastForward(3 * 60 * 1000);
    await waitAsleep(page, true, 5000);
    assert.equal(await diagnosticsRow(page, 'Sleep'), 'asleep (idle)');
    check('clock stepped +2 h, a poll that sees playback in the same second: idle sleep starts an hour after the last playback, not an hour + 2 h');
  } finally {
    await mock.stop();
  }
});

// 22b. Asleep in the window, a key starts a manual wake; a pointer move after a clock step restarts it from the new clock.
sleepCase('22b manual wake: step, then a pointer move in the same second', { settings: seed({ showNowPlaying: false }), clock: { time: INSIDE } }, async ({ page, app, mock }) => {
  await mock.stop();
  await page.goto(app.url);
  await waitAsleep(page);
  await page.keyboard.press('a'); // wakes for 60 s
  await waitAsleep(page, false);
  await page.waitForTimeout(200);
  await page.clock.setSystemTime(new Date('2026-01-05T04:00:00')); // +1 h, still inside the window
  await page.mouse.move(300, 300); // restarts the minute (the first move also reaches the page)
  await advance(page, 50_000, 5000);
  assert.equal(await isAsleep(page), false, 'still awake at 50 s');
  await advance(page, 15_000, 1000);
  await waitAsleep(page, true, 5000);
  check('clock stepped +1 h during a manual wake, pointer move in the same second: the wake ends about 60 s later, not an hour');
});

// ---------- run ----------

const WORKERS = Number(process.env.E2E_SLEEP_WORKERS || 4);
if (process.env.E2E_SLEEP_ONLY) {
  const only = new RegExp(process.env.E2E_SLEEP_ONLY); // run just the matching cases, e.g. E2E_SLEEP_ONLY='^1[0-2]'
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
      } catch (err) {
        failures.push({ name, err });
      }
    }
  }),
);
for (const { name, err } of failures) console.error(`case ${name} failed:\n${err?.stack || err}`);
if (failures.length) process.exit(1);
