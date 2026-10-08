import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLoopback, isLoopbackHost } from '../scripts/net.mjs';

// ---- unit -----------------------------------------------------------------
test('isLoopback accepts only loopback peers', () => {
  for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(a), true, a);
  for (const a of ['127.0.0.1.evil', '1270.0.0.1', '127.0.0.256', '127.1', '127.0.0.1 ', '::ffff:127.0.0.256',
    '::ffff:192.168.1.5', '192.168.1.5', '', undefined]) assert.equal(isLoopback(a), false, String(a));
});

test('isLoopbackHost compares the hostname only, ignoring the port', () => {
  for (const h of ['localhost', 'localhost:8080', '127.0.0.1:3000', '[::1]:8080', '[::1]'])
    assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['evil.example', 'localhost.evil.com', 'localhost@evil.example', '', undefined])
    assert.equal(isLoopbackHost(h), false, String(h));
});

// ---- integration ----------------------------------------------------------
const lan = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

const root = mkdtempSync(join(tmpdir(), 'serve-test-'));
for (const [f, body] of Object.entries({
  'index.html': 'INDEX', 'sw.js': 'SW', 'manifest.webmanifest': '{}', 'css/a.css': 'a{}', 'js/a.js': '//a',
  'assets/a.png': 'PNG', 'config.json': '{"plexToken":"SECRET"}', '.orchestrator/x.md': 'x', 'docs/spec.md': 's',
  'package.json': '{}', 'README.md': 'r', 'assets-private/x.png': 'P', 'jsx/a.js': '//j', 'js/.env': 'ENV',
})) {
  mkdirSync(join(root, f, '..'), { recursive: true });
  writeFileSync(join(root, f), body);
}

const outside = mkdtempSync(join(tmpdir(), 'serve-outside-'));
writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE');
symlinkSync(join(outside, 'secret.txt'), join(root, 'assets/link.png'));
symlinkSync(join(root, 'config.json'), join(root, 'assets/cfg.png'));

let child, port;
// Spawn serve.mjs on a free port for rootDir; returns { child, port }.
async function spawnServer(rootDir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await freePort();
    const c = spawn(process.execPath, ['scripts/serve.mjs', '--host', '0.0.0.0', '--port', String(p), '--root', rootDir], {
      cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outcome = await new Promise((ok) => {
      c.stdout.once('data', () => ok('up'));
      c.once('exit', () => ok('exit'));
    });
    if (outcome === 'up') return { child: c, port: p };
  }
  throw new Error('could not start serve.mjs');
}
async function start() { ({ child, port } = await spawnServer(root)); }

// Raw request so Host can be set and the path is sent untouched.
function get(path, { to = '127.0.0.1', host, headers = {}, at = port, timeout = 0 } = {}) {
  return new Promise((ok, fail) => {
    const req = request({ host: to, port: at, path, timeout, headers: { Host: host ?? `${to}:${at}`, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('error', fail);
    req.on('timeout', () => req.destroy(new Error(`timeout: ${path}`)));
    req.end();
  });
}

test.before(start);
test.after(() => { child?.kill(); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

test('loopback peer with a loopback Host gets config.json', async () => {
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    const r = await get('/config.json', { host });
    assert.equal(r.status, 200, host);
    assert.match(r.body, /SECRET/);
  }
});

test('loopback peer with a foreign Host is refused config.json', async () => {
  for (const host of ['evil.example', `evil.example:${port}`, `localhost.evil.com:${port}`]) {
    const r = await get('/config.json', { host });
    assert.equal(r.status, 403, host);
    assert.doesNotMatch(r.body, /SECRET/);
  }
});

test('config.json path variants are never 200 for a non-loopback peer', { skip: !lan }, async () => {
  const paths = ['/config.json', '//config.json', '/./config.json', '/%63onfig.json', '/config.json/', '/CONFIG.JSON',
    '/js/../config.json', '/js/%2e%2e/config.json', '/config.json?x=1', '/config.json%00.js'];
  for (const p of paths) {
    const r = await get(p, { to: lan });
    // Exact spelling after decoding (query ignored) is refused 403; every other spelling is 404.
    assert.equal(r.status, ['/config.json', '/config.json?x=1', '/%63onfig.json'].includes(p) ? 403 : 404, p);
    assert.doesNotMatch(r.body, /SECRET/, p);
  }
  // Loopback-looking Host from the LAN peer: only the proxy header could change the answer, and it must not.
  const xff = ['X', 'Forwarded', 'For'].join('-');
  assert.equal((await get('/config.json', { to: lan, host: `localhost:${port}`, headers: { [xff]: '127.0.0.1' } })).status, 403);
  assert.equal((await get('/config.json', { to: lan, host: `localhost:${port}` })).status, 403);
});

test('other proxy-style headers from the LAN peer do not unlock config.json', { skip: !lan }, async () => {
  // Header names are built here so scripts/ never needs the word (plan criterion 4).
  const fwd = ['For', 'ward', 'ed'].join('');
  const real = ['X', 'Real', 'IP'].join('-');
  const xfh = ['X', fwd, 'Host'].join('-');
  for (const headers of [{ [fwd]: 'for=127.0.0.1' }, { [real]: '127.0.0.1' }, { [xfh]: 'localhost' }]) {
    const r = await get('/config.json', { to: lan, host: `localhost:${port}`, headers });
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.doesNotMatch(r.body, /SECRET/);
  }
});

test('config.json variants never leak even from loopback', async () => {
  for (const p of ['/config.json/', '/CONFIG.JSON', '/./config.json', '//config.json', '/js/../config.json']) {
    const r = await get(p, { host: `localhost:${port}` });
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /SECRET/, p);
  }
});

test('LAN peer gets the app files only', { skip: !lan }, async () => {
  for (const p of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/css/a.css', '/js/a.js', '/assets/a.png'])
    assert.equal((await get(p, { to: lan })).status, 200, p);
  for (const p of ['/.orchestrator/x.md', '/docs/spec.md', '/package.json', '/README.md', '/css', '/css/', '/nope'])
    assert.equal((await get(p, { to: lan })).status, 404, p);
});

test('sibling paths sharing a directory prefix are 404', { skip: !lan }, async () => {
  for (const p of ['/assets-private/x.png', '/jsx/a.js'])
    assert.equal((await get(p, { to: lan })).status, 404, p);
});

test('symlinks leaving the root or reaching config.json are 404', { skip: !lan }, async () => {
  for (const p of ['/assets/link.png', '/assets/cfg.png']) {
    const r = await get(p, { to: lan });
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /SECRET|OUTSIDE/, p);
  }
});

test('dotfiles under app directories are 404', { skip: !lan }, async () => {
  const r = await get('/js/.env', { to: lan });
  assert.equal(r.status, 404);
  assert.doesNotMatch(r.body, /ENV/);
});

const mkfifo = spawnSync('mkfifo', ['--version']).error ? false : true;

test('a FIFO or directory under assets/ is 404 within 2 s and the server keeps answering', { skip: !mkfifo && 'mkfifo unavailable' }, async () => {
  mkdirSync(join(root, 'assets/subdir'), { recursive: true });
  const made = spawnSync('mkfifo', [join(root, 'assets/pipe.png')]);
  assert.equal(made.status, 0, 'mkfifo failed');
  for (const p of ['/assets/pipe.png', '/assets/subdir', '/assets/subdir/']) {
    const r = await get(p, { timeout: 2000 });
    assert.equal(r.status, 404, p);
    assert.equal((await get('/assets/a.png', { timeout: 2000 })).status, 200, `after ${p}`);
  }
});

test('config.json that is a symlink leaving the root is 404 even for loopback', async () => {
  const r2 = mkdtempSync(join(tmpdir(), 'serve-cfglink-'));
  const out2 = mkdtempSync(join(tmpdir(), 'serve-cfgout-'));
  writeFileSync(join(out2, 'outside.json'), '{"plexToken":"OUTSIDE"}');
  writeFileSync(join(r2, 'index.html'), 'INDEX');
  symlinkSync(join(out2, 'outside.json'), join(r2, 'config.json'));
  const s = await spawnServer(r2);
  try {
    const r = await get('/config.json', { host: `localhost:${s.port}`, at: s.port, timeout: 2000 });
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.body, /OUTSIDE/);
    assert.equal((await get('/', { at: s.port })).status, 200);
  } finally {
    s.child.kill();
    rmSync(r2, { recursive: true, force: true });
    rmSync(out2, { recursive: true, force: true });
  }
});

test('a served root that is itself a symlink still serves the app, config.json loopback-only', async () => {
  const holder = mkdtempSync(join(tmpdir(), 'serve-rootlink-'));
  const link = join(holder, 'link');
  symlinkSync(root, link);
  const s = await spawnServer(link);
  try {
    for (const p of ['/', '/index.html', '/js/a.js', '/css/a.css', '/assets/a.png'])
      assert.equal((await get(p, { at: s.port })).status, 200, p);
    assert.equal((await get('/config.json', { at: s.port, host: `localhost:${s.port}` })).status, 200);
    assert.equal((await get('/config.json', { at: s.port, host: 'evil.example' })).status, 403);
    assert.equal((await get('/docs/spec.md', { at: s.port })).status, 404);
    if (lan) assert.equal((await get('/config.json', { to: lan, at: s.port, host: `localhost:${s.port}` })).status, 403);
  } finally {
    s.child.kill();
    rmSync(holder, { recursive: true, force: true });
  }
});
