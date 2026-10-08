// Smoke spec: the app loads against the mock server, and every harness option later phases rely on works.

import assert from 'node:assert/strict';
import { withApp } from './lib.mjs';

const seedFor = (app) => ({ plexToken: 'demo-token', serverUrl: `http://127.0.0.1:${app.mockPort}`, libraryKey: '1' });
const check = (name) => console.log(`  ok  ${name}`);

// Poster renders and the console stays clean.
await withApp({ settings: seedFor }, async ({ page, app }) => {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(app.url);
  await page.waitForFunction(() => [...document.querySelectorAll('.poster-layer')].some((i) => i.naturalWidth > 0), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
  check('poster layer loads, no console errors');
});

// serveArgs: [] starts a dedicated server on its own ports; stop() kills it.
await withApp({ serveArgs: [] }, async ({ app }) => {
  assert.notEqual(app.port, Number(process.env.E2E_PORT || 18080));
  assert.notEqual(app.mockPort, Number(process.env.E2E_MOCK_PORT || 18401));
  assert.equal((await fetch(app.url)).status, 200);
  app.stop();
  await new Promise((r) => setTimeout(r, 300));
  await assert.rejects(fetch(app.url));
  check('serveArgs [] -> dedicated server, stop() ends it');
});

// serveArgs are passed through verbatim after --mock.
await withApp({ serveArgs: ['--helper', '--helper-fake'] }, async ({ app }) => {
  assert.deepEqual(app.argv, ['--mock', '--helper', '--helper-fake']);
  assert.deepEqual(app.spawned.slice(-2), ['--helper', '--helper-fake']);
  assert.equal(app.spawned.filter((a) => a === '--helper').length, 1);
  check('serveArgs passed through to the child');
});

// Service workers: blocked by default, opt-in with 'allow'.
await withApp({}, async ({ page, app }) => {
  await page.goto(app.url);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  check('service workers blocked by default');
});
await withApp({ serviceWorkers: 'allow' }, async ({ page, app }) => {
  await page.goto(app.url);
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length > 0, null, { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  check("serviceWorkers 'allow' registers and controls after a reload");
});

// Fake clock.
await withApp({ clock: { time: '2026-01-05T03:59:30' } }, async ({ page, app }) => {
  await page.goto(app.url);
  assert.equal(await page.evaluate(() => new Date().getFullYear()), 2026);
  const t0 = await page.evaluate(() => Date.now());
  await page.clock.runFor(60000);
  const t1 = await page.evaluate(() => Date.now());
  assert.ok(t1 - t0 >= 60000 && t1 - t0 < 62000, `advanced ${t1 - t0}ms`);
  check('clock install + runFor');
});

// Touch.
await withApp({ hasTouch: true }, async ({ page, app }) => {
  await page.goto(app.url);
  assert.ok((await page.evaluate(() => navigator.maxTouchPoints)) > 0);
});
await withApp({}, async ({ page, app }) => {
  await page.goto(app.url);
  assert.equal(await page.evaluate(() => navigator.maxTouchPoints), 0);
  check('hasTouch toggles maxTouchPoints');
});

// localStorage seeding, visible to the first script on the page.
await withApp({ localStorage: { 'plexPoster.lastReload': '123' } }, async ({ page, app }) => {
  await page.addInitScript(() => (window.__first = localStorage.getItem('plexPoster.lastReload')));
  await page.goto(app.url);
  assert.equal(await page.evaluate(() => window.__first), '123');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('plexPoster.settings')).pixelShift), false);
  assert.equal(await page.evaluate(() => typeof window.__wakeLock.requests), 'number');
  check('localStorage seed + pixelShift false + wake lock stub');
});

// Contract defaults: whatsNew seeded, dailyReload false.
await withApp({}, async ({ page, app }) => {
  await page.goto(app.url);
  assert.notEqual(await page.evaluate(() => localStorage.getItem('plexPoster.whatsNew')), null);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('plexPoster.settings')).dailyReload), false);
  check('whatsNew seeded, dailyReload false');
});

// Wake-lock stub: counting and faithful sentinel.
await withApp({}, async ({ page, app }) => {
  await page.goto(app.url);
  const r = await page.evaluate(async () => {
    const wl = window.__wakeLock;
    const s = await navigator.wakeLock.request('screen');
    const afterRequest = { ...wl, released: s.released };
    let fired = 0;
    s.addEventListener('release', () => fired++);
    await s.release();
    return { afterRequest, afterRelease: { ...wl, released: s.released }, fired };
  });
  assert.deepEqual(r.afterRequest, { held: 1, requests: 1, releases: 0, released: false });
  assert.deepEqual(r.afterRelease, { held: 0, requests: 1, releases: 1, released: true });
  assert.equal(r.fired, 1);
  check('wake-lock stub counts and sentinel released/release event are faithful');
});

// viewport and isMobile.
await withApp({ viewport: { width: 500, height: 800 } }, async ({ page, app }) => {
  await page.goto(app.url);
  assert.equal(await page.evaluate(() => innerWidth), 500);
  check('viewport sets innerWidth');
});
// isMobile: a page without a viewport meta lays out at 980px on a mobile context, at the real width otherwise.
const layoutWidth = async (opts) =>
  withApp({ viewport: { width: 500, height: 800 }, ...opts }, async ({ page, app }) => {
    await page.route('**/e2e-nometa', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body>x' }));
    await page.goto(`${app.url}e2e-nometa`);
    return page.evaluate(() => document.documentElement.clientWidth);
  });
assert.equal(await layoutWidth({ isMobile: true }), 980);
assert.equal(await layoutWidth({}), 500);
check('isMobile gives a mobile signal (980px layout without viewport meta)');
