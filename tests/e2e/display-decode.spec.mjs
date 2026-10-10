// Rotation never stalls on a pending image decode (phase display-decode-hang, D30, Q25).
//
// The race: a draw's cleanup timer (crossfadeMs + 200 ms) removed the src of a layer that the next
// draw was already decoding on. Removing src before the load finishes leaves decode() pending
// forever in Chromium, tick() never returned, state.busy stayed set and every later refresh was
// ignored until reload. Refreshes spaced exactly crossfadeMs + 200 ms apart put the timer on top of
// the next draw, so each case presses refresh (the R key, a forced tick) 60 times at that spacing.
// After every press the draw must complete (the active poster layer changes), so the next refresh
// is accepted, and at the end no decode() may be left pending. The skipped cleanup timer must not
// leak object URLs either: at the end every live object URL is one a poster layer still shows.
// The presses must land close to the crossfadeMs + 200 ms target, or the race window is missed, so a
// run where more than 10% of the gaps drift by over 50 ms fails loudly instead of proving less.

import assert from 'node:assert/strict';
import { withApp } from './lib.mjs';

const PRESSES = 60;
const SETTLE_MS = 5000; // a draw takes tens of ms; far longer means the display is stuck
const DRIFT_MS = 50; // a press gap further than this from crossfadeMs + 200 ms has missed the race window
const DRIFT_MAX = 0.1; // share of gaps allowed to drift before the run is too loose to prove anything

const seedFor = (crossfadeMs) => (app) => ({
  plexToken: 'demo-token',
  serverUrl: `http://127.0.0.1:${app.mockPort}`,
  libraryKey: '1',
  crossfadeMs,
  rotateSeconds: 3600, // only the pressed refreshes draw
  pixelShift: false,
});

/** Runs in the page before any script: counts draws, pending decode() calls, object URLs and key presses. */
function instrument() {
  const probe = (window.__probe = {
    draws: 0,
    started: 0,
    settled: 0,
    pending: new Map(),
    seq: 0,
    created: 0,
    revoked: 0,
    live: new Set(),
    keys: [],
  });
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = function createObjectURL(obj) {
    const url = create.call(this, obj);
    probe.created++;
    probe.live.add(url);
    return url;
  };
  URL.revokeObjectURL = function revokeObjectURL(url) {
    probe.revoked++;
    probe.live.delete(url);
    return revoke.call(this, url);
  };
  window.addEventListener('keydown', (e) => e.key === 'r' && probe.keys.push(Date.now()), true);
  const orig = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function decode() {
    const id = ++probe.seq;
    probe.started++;
    probe.pending.set(id, performance.now());
    const done = () => {
      probe.pending.delete(id);
      probe.settled++;
    };
    const p = orig.call(this);
    p.then(done, done);
    return p;
  };
  // A draw completes when a poster layer gains .active.
  new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target;
      if (t.classList?.contains('poster-layer') && t.classList.contains('active') && !(r.oldValue || '').split(/\s+/).includes('active')) probe.draws++;
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapshot(page) {
  return page.evaluate(() => {
    const now = performance.now();
    const p = window.__probe;
    const layers = [...document.querySelectorAll('.poster-layer')];
    return {
      draws: p.draws,
      started: p.started,
      settled: p.settled,
      pendingAges: [...p.pending.values()].map((t) => Math.round(now - t)),
      activeLayer: layers.findIndex((l) => l.classList.contains('active')),
      hasSrc: layers.map((l) => l.hasAttribute('src')),
      shown: layers.map((l) => l.getAttribute('src')),
      created: p.created,
      revoked: p.revoked,
      live: [...p.live],
      keys: [...p.keys],
    };
  });
}

/** Waits until at least `n` draws have completed; returns the snapshot, or null on timeout. */
async function drawsReached(page, n, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await snapshot(page);
    if (s.draws >= n) return s;
    if (Date.now() >= deadline) return null;
    await sleep(10);
  }
}

for (const crossfadeMs of [0, 1200]) {
  const name = `crossfadeMs ${crossfadeMs}`;
  await withApp({ settings: seedFor(crossfadeMs) }, async ({ page, app }) => {
    await page.addInitScript(instrument);
    await page.goto(app.url);
    const first = await drawsReached(page, 1, 15000);
    assert.ok(first, `${name}: the first poster is drawn`);
    // Let the first draw's crossfade and cleanup timer pass so every press starts from rest.
    await sleep(crossfadeMs + 400);

    const gap = crossfadeMs + 200;
    const start = Date.now();
    for (let i = 0; i < PRESSES; i++) {
      const wait = start + i * gap - Date.now();
      if (wait > 0) await sleep(wait);
      const before = await snapshot(page);
      await page.keyboard.press('r');
      const after = await drawsReached(page, before.draws + 1, SETTLE_MS);
      assert.ok(
        after,
        `${name}: press ${i + 1} did not draw within ${SETTLE_MS} ms (draws ${before.draws}, active layer ${before.activeLayer}, pending decode ages ${JSON.stringify((await snapshot(page)).pendingAges)})`,
      );
      assert.notEqual(after.activeLayer, before.activeLayer, `${name}: press ${i + 1} changed the active poster layer`);
    }

    // Let the last cleanup timer fire, then nothing may be left pending.
    await sleep(crossfadeMs + 500);
    const end = await snapshot(page);
    assert.equal(end.draws, 1 + PRESSES, `${name}: one draw per press`);
    assert.deepEqual(end.pendingAges, [], `${name}: no decode() left pending`);
    assert.equal(end.started, end.settled, `${name}: every decode() settled`);
    assert.ok(end.hasSrc[end.activeLayer], `${name}: the active layer keeps its image`);

    // No object URL may outlive the layer that showed it: every live one is still on a layer.
    const leaked = end.live.filter((u) => !end.shown.includes(u));
    assert.deepEqual(leaked, [], `${name}: no object URL left unrevoked (${end.created} created, ${end.revoked} revoked, ${end.live.length} live, layers show ${end.shown.length})`);
    assert.ok(end.created > PRESSES, `${name}: the probe saw the object URLs (${end.created} created)`);

    // The presses must have landed on the target spacing, or the run proved less than it claims.
    assert.equal(end.keys.length, PRESSES, `${name}: every press reached the page`);
    const gaps = end.keys.slice(1).map((t, i) => t - end.keys[i]);
    const drifted = gaps.filter((g) => Math.abs(g - gap) > DRIFT_MS).length;
    console.log(`  ok  ${name}: ${PRESSES} presses, ${end.started} decodes, ${end.created} object URLs (${end.live.length} live), ${drifted}/${gaps.length} presses drifted over ${DRIFT_MS} ms from ${gap} ms`);
    assert.ok(drifted <= gaps.length * DRIFT_MAX, `${name}: ${drifted} of ${gaps.length} press gaps drifted over ${DRIFT_MS} ms from ${gap} ms (more than ${DRIFT_MAX * 100}%): the machine is too slow to hit the race window`);
  });
}
