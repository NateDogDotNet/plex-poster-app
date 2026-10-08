// Cache-first fetch: showing the same 8 posters repeatedly downloads each once, and a reload hits the cache.

import assert from 'node:assert/strict';
import { withApp } from './lib.mjs';

const seedFor = (app) => ({ plexToken: 'demo-token', serverUrl: `http://127.0.0.1:${app.mockPort}`, libraryKey: '1' });
const check = (name) => console.log(`  ok  ${name}`);

const loaded = (page) => page.waitForFunction(() => [...document.querySelectorAll('.poster-layer')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 });

/** Click the refresh control and give the tick time to finish (a click during a busy tick is ignored). */
async function showNext(page) {
  await page.click('[data-action="refresh"]');
  await page.waitForTimeout(300);
}
const cachedCount = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('plexPoster.posterIndex') || '[]').length);

await withApp({ settings: (app) => ({ ...seedFor(app), rotateSeconds: 3600 }) }, async ({ page, app, mock }) => {
  await page.addInitScript(() => {
    window.__puts = 0;
    const put = Cache.prototype.put;
    Cache.prototype.put = function (...a) {
      window.__puts++;
      return put.apply(this, a);
    };
  });
  await mock.post('reset-stats');
  assert.equal((await mock.get('stats')).transcode, 0);
  await page.goto(app.url);
  await loaded(page);

  // 24 shows via the refresh control; the pool is the 8 mock titles.
  for (let i = 0; i < 24; i++) await showNext(page);
  const stats = await mock.get('stats');
  const puts = await page.evaluate(() => window.__puts);
  assert.ok(stats.transcode <= 8, `transcode ${stats.transcode} > 8`);
  assert.ok(puts <= 8, `Cache.put ${puts} > 8`);
  assert.ok(stats.transcode >= 1);
  check(`24 shows: transcode ${stats.transcode} <= 8, Cache.put ${puts} <= 8`);

  // Make sure all 8 are cached (the pool is random), then reload and show them again with no downloads.
  for (let i = 0; i < 60 && (await cachedCount(page)) < 8; i++) await showNext(page);
  assert.equal(await cachedCount(page), 8);

  await page.reload();
  await loaded(page);
  await mock.post('reset-stats');
  for (let i = 0; i < 24; i++) await showNext(page);
  const after = await mock.get('stats');
  assert.equal(after.transcode, 0, `transcode after reload ${after.transcode}`);
  check('after reload + reset-stats, 24 shows: transcode == 0');

  // A corrupt cached blob: every stored blob is overwritten with undecodable bytes, then each poster is
  // fetched once over the network, the cache heals, and there is no lasting "could not be decoded" loop.
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.evaluate(async () => {
    const cache = await caches.open('plex-posters-v1');
    for (const req of await cache.keys()) await cache.put(req, new Response('garbage', { headers: { 'Content-Type': 'image/jpeg' } }));
  });
  await mock.post('reset-stats');
  for (let i = 0; i < 80 && (await mock.get('stats')).transcode < 8; i++) await showNext(page);
  for (let i = 0; i < 24; i++) await showNext(page); // all 8 are healed now: only hits
  const healed = await mock.get('stats');
  assert.equal(healed.transcode, 8, `transcode after corruption ${healed.transcode}`);
  assert.equal(logs.filter((t) => t.includes('could not be decoded')).length, 0, 'decode error loop');
  const valid = await page.evaluate(async () => {
    const cache = await caches.open('plex-posters-v1');
    let ok = 0;
    for (const req of await cache.keys()) {
      const url = URL.createObjectURL(await (await cache.match(req)).blob());
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
        ok++;
      } catch {}
      URL.revokeObjectURL(url);
    }
    return { ok, total: (await cache.keys()).length };
  });
  assert.deepEqual(valid, { ok: 8, total: 8 });
  check('corrupted cache: each poster fetched once (transcode 8), no decode loop, cache valid again');
});
