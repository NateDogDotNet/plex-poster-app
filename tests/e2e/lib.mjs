// Shared helpers for the browser specs (tests/e2e/*.spec.mjs).
//
//   await withApp({ settings, viewport, hasTouch, isMobile, clock, serviceWorkers,
//                   serveArgs, localStorage }, async ({ page, context, app, mock }) => { ... });
//
// app = { url, port, mockPort, argv, stop() }. Without serveArgs the spec uses the shared server
// that run.mjs started on E2E_PORT / E2E_MOCK_PORT. Passing serveArgs (even []) starts a dedicated
// `serve.mjs --mock` child on freshly probed ports, which is killed when the callback returns.

import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SERVE = join(ROOT, 'scripts', 'serve.mjs');
export const E2E_PORT = Number(process.env.E2E_PORT || 18080);
export const E2E_MOCK_PORT = Number(process.env.E2E_MOCK_PORT || 18401);

// Prefer the local devDependency; fall back to the global install (a bare ESM import does not find it).
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const mod = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright');
    return mod.default || mod;
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium || pw.default?.chromium;

// Defaults every spec starts from (convention 7): geometry specs must not see pixel shift,
// and the upgrade toast must not interfere.
const DEFAULT_SETTINGS = { pixelShift: false, dailyReload: false };
const WHATS_NEW_MARKER = 'e2e';

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Spawn serve.mjs and resolve once both servers print their banner. Rejects if it exits first. */
export function spawnServe(argv) {
  const child = spawn(process.execPath, [SERVE, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const ready = new Promise((resolve, reject) => {
    const onData = (d) => {
      out += d;
      if (/Mock Plex server/.test(out)) resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => (out += d));
    child.once('exit', (code) => reject(Object.assign(new Error(`serve.mjs exited ${code}: ${out}`), { output: out })));
  });
  return { child, ready };
}

async function startDedicated(serveArgs) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePort();
    let mockPort = await freePort();
    while (mockPort === port) mockPort = await freePort();
    const argv = ['--mock', '--port', String(port), '--mock-port', String(mockPort), ...serveArgs];
    const { child, ready } = spawnServe(argv);
    try {
      await ready;
      return { child, port, mockPort, argv: ['--mock', ...serveArgs], spawned: argv };
    } catch (e) {
      child.kill();
      if (!/EADDRINUSE/.test(e.output || '')) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

function makeMock(mockPort) {
  const base = `http://127.0.0.1:${mockPort}/__mock/`;
  const call = async (method, action, params = {}) => {
    const q = new URLSearchParams(params).toString();
    const res = await fetch(`${base}${action}${q ? `?${q}` : ''}`, { method });
    return res.json();
  };
  return {
    get: (action) => call('GET', action),
    post: (action, params) => call('POST', action, params),
    play: (ratingKey, params = {}) => call('POST', 'play', { ratingKey, ...params }),
    stop: () => call('POST', 'stop'),
    down: () => call('POST', 'down'),
    up: () => call('POST', 'up'),
    stats: () => call('GET', 'stats'),
  };
}

export async function withApp(opts, fn) {
  const { settings = {}, viewport, hasTouch = false, isMobile = false, clock, serviceWorkers = 'block', serveArgs, localStorage = {} } = opts;

  let dedicated = null;
  let app;
  if (serveArgs) {
    dedicated = await startDedicated(serveArgs);
    app = { url: `http://127.0.0.1:${dedicated.port}/`, port: dedicated.port, mockPort: dedicated.mockPort, argv: dedicated.argv, spawned: dedicated.spawned };
    app.stop = () => dedicated.child.kill();
  } else {
    app = { url: `http://127.0.0.1:${E2E_PORT}/`, port: E2E_PORT, mockPort: E2E_MOCK_PORT, argv: ['--mock'], stop() {} };
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      viewport: viewport || { width: 1280, height: 720 },
      hasTouch,
      isMobile,
      serviceWorkers: serviceWorkers === 'allow' ? 'allow' : 'block',
    });
    const page = await context.newPage();

    // `settings` may be a function of app so a dedicated server's mock port can be used in the seed.
    const seed = { ...DEFAULT_SETTINGS, ...(typeof settings === 'function' ? settings(app) : settings) };
    await context.addInitScript(
      ({ seed, extra, marker }) => {
        // Seed only when absent so a reload keeps whatever the app saved since.
        const put = (k, v) => localStorage.getItem(k) === null && localStorage.setItem(k, v);
        put('plexPoster.settings', JSON.stringify(seed));
        put('plexPoster.whatsNew', marker);
        for (const [k, v] of Object.entries(extra)) put(k, String(v));
        // Headless Chromium has no usable wake lock: count requests instead.
        const wl = (window.__wakeLock = { held: 0, requests: 0, releases: 0 });
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: {
            request: async () => {
              wl.requests++;
              wl.held++;
              const listeners = [];
              const sentinel = {
                released: false,
                type: 'screen',
                addEventListener: (type, fn) => type === 'release' && listeners.push(fn),
                removeEventListener: (type, fn) => {
                  const i = listeners.indexOf(fn);
                  if (type === 'release' && i >= 0) listeners.splice(i, 1);
                },
                release: async () => {
                  if (sentinel.released) return;
                  sentinel.released = true;
                  wl.held--;
                  wl.releases++;
                  for (const fn of [...listeners]) fn.call(sentinel, { type: 'release', target: sentinel });
                  sentinel.onrelease?.({ type: 'release', target: sentinel });
                },
              };
              return sentinel;
            },
          },
        });
      },
      { seed, extra: localStorage, marker: WHATS_NEW_MARKER },
    );
    if (clock) await page.clock.install(clock);

    return await fn({ page, context, app, mock: makeMock(app.mockPort) });
  } finally {
    await browser.close().catch(() => {});
    if (dedicated) dedicated.child.kill();
  }
}

/** Save a PNG into $E2E_SHOTS when it is set; a no-op otherwise. */
export async function shot(page, name) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}
