import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { Readable } from 'node:stream';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHelper, killProcessGroup } from '../scripts/device-helper.mjs';

// ---- helpers ---------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'helper-test-'));
const thermal = join(dir, 'temp');
writeFileSync(thermal, '48312\n');

// Fake execFile: records every call; `hang` leaves the callback uncalled. The fake child has no pid
// unless one is asked for, so the default group kill can never signal a real, unrelated process group.
function fakeExec({ hang = false, pid } = {}) {
  const calls = [];
  const execFile = (file, args, opts, cb) => {
    const rec = { file, args, opts, input: undefined, killed: false };
    calls.push(rec);
    if (!hang) setImmediate(() => cb(null, '', ''));
    return { pid, stdin: { end: (s) => { rec.input = s; } }, kill: () => { rec.killed = true; } };
  };
  return { calls, execFile };
}

async function make(opts = {}) {
  const ex = fakeExec(opts.exec);
  const helper = await createHelper({
    execFile: ex.execFile,
    thermalPath: thermal,
    power: 'cec-ctl',
    which: () => false,
    env: {},
    ...opts.config,
  });
  return { helper, ex };
}

// Drive the handler with mock req/res so the peer address can be anything.
function call(helper, { method = 'POST', url = '/__helper/display', body, headers = {}, peer = '127.0.0.1', host = 'localhost:8080', poster = true } = {}) {
  return new Promise((ok) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
    req.method = method;
    req.url = url;
    req.headers = { host, ...(poster ? { 'x-poster-helper': '1' } : {}), ...headers };
    if (host === null) delete req.headers.host;
    req.socket = { remoteAddress: peer === null ? undefined : peer };
    const res = {
      writeHead(status) { this.status = status; },
      end(text = '') { ok({ status: this.status, body: String(text) }); },
    };
    const handled = helper.handle(req, res);
    if (!handled) ok({ status: 'unhandled' });
  });
}
const json = (r) => JSON.parse(r.body);
const on = (v) => ({ body: { on: v } });
const status = (h) => call(h, { method: 'GET', url: '/__helper/status' });

// ---- strategies ------------------------------------------------------------
test('cec-ctl runs exactly the standby / image-view-on argv', async () => {
  const { helper, ex } = await make();
  assert.equal((await call(helper, on(false))).status, 200);
  assert.equal((await call(helper, on(true))).status, 200);
  assert.deepEqual(ex.calls.map((c) => [c.file, c.args]), [
    ['cec-ctl', ['-d', '/dev/cec0', '--to', '0', '--standby']],
    ['cec-ctl', ['-d', '/dev/cec0', '--to', '0', '--image-view-on']],
  ]);
});

test('cec-ctl and cec-client children get PATH only, nothing from the helper environment', async () => {
  for (const power of ['cec-ctl', 'cec-client']) {
    const { helper, ex } = await make({ config: { power, env: { PATH: '/x/bin', PLEX_TOKEN: 'SECRET', HOME: '/root', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' } } });
    await call(helper, on(false));
    assert.deepEqual(ex.calls[0].opts.env, { PATH: '/x/bin' }, power);
  }
  const { helper, ex } = await make({ config: { env: { PLEX_TOKEN: 'SECRET' } } });
  await call(helper, on(true));
  assert.deepEqual(Object.keys(ex.calls[0].opts.env), ['PATH'], 'default PATH when the environment has none');
});

test('cec-client gets standby 0 / on 0 on stdin', async () => {
  const { helper, ex } = await make({ config: { power: 'cec-client' } });
  await call(helper, on(false));
  await call(helper, on(true));
  assert.deepEqual(ex.calls.map((c) => [c.file, c.args, c.input]), [
    ['cec-client', ['-s', '-d', '1'], 'standby 0\n'],
    ['cec-client', ['-s', '-d', '1'], 'on 0\n'],
  ]);
});

test('wlr-randr runs --off / --on with only the compositor env', async () => {
  const { helper, ex } = await make({ config: {
    power: 'wlr-randr', output: 'HDMI-A-1',
    env: { WAYLAND_DISPLAY: 'wayland-1', XDG_RUNTIME_DIR: '/run/user/1000', PLEX_TOKEN: 'SECRET', HOME: '/root' },
  } });
  await call(helper, on(false));
  await call(helper, on(true));
  assert.deepEqual(ex.calls.map((c) => [c.file, c.args]), [
    ['wlr-randr', ['--output', 'HDMI-A-1', '--off']],
    ['wlr-randr', ['--output', 'HDMI-A-1', '--on']],
  ]);
  for (const c of ex.calls) {
    assert.equal(c.opts.env.WAYLAND_DISPLAY, 'wayland-1');
    assert.equal(c.opts.env.XDG_RUNTIME_DIR, '/run/user/1000');
    assert.ok(Object.keys(c.opts.env).every((k) => ['WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'PATH'].includes(k)), JSON.stringify(c.opts.env));
    assert.ok(!JSON.stringify(c.opts).includes('SECRET'));
    assert.ok(!c.opts.shell);
  }
});

test('flags beat the helper environment for wlr-randr', async () => {
  const { helper, ex } = await make({ config: {
    power: 'wlr-randr', output: 'DP-1', waylandDisplay: 'wayland-9', xdgRuntimeDir: '/run/user/42',
    env: { WAYLAND_DISPLAY: 'wayland-1', XDG_RUNTIME_DIR: '/run/user/1000' },
  } });
  await call(helper, on(false));
  assert.equal(ex.calls[0].opts.env.WAYLAND_DISPLAY, 'wayland-9');
  assert.equal(ex.calls[0].opts.env.XDG_RUNTIME_DIR, '/run/user/42');
});

test('an absolute WAYLAND_DISPLAY socket path is accepted (flag and environment), still validated', async () => {
  const { helper, ex } = await make({ config: { power: 'wlr-randr', output: 'DP-1', waylandDisplay: '/run/user/1000/wayland-0', xdgRuntimeDir: '/run/user/1000' } });
  assert.equal((await call(helper, on(false))).status, 200);
  assert.equal(ex.calls[0].opts.env.WAYLAND_DISPLAY, '/run/user/1000/wayland-0');
  const viaEnv = await make({ config: { power: 'wlr-randr', output: 'DP-1', env: { WAYLAND_DISPLAY: '/run/user/1000/wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' } } });
  await call(viaEnv.helper, on(true));
  assert.equal(viaEnv.ex.calls[0].opts.env.WAYLAND_DISPLAY, '/run/user/1000/wayland-0');
  for (const bad of ['/run/user/../etc/x', '/a b', '/run/x\ny', 'rel/ative', '/x/..']) {
    await assert.rejects(createHelper({ execFile: fakeExec().execFile, power: 'wlr-randr', output: 'DP-1', waylandDisplay: bad, env: {} }), bad);
    await assert.rejects(createHelper({ execFile: fakeExec().execFile, power: 'wlr-randr', output: 'DP-1', env: { WAYLAND_DISPLAY: bad, XDG_RUNTIME_DIR: '/run/user/1000' } }), `env ${bad}`);
  }
});

test('wlr-randr without a compositor environment runs nothing', async () => {
  const { helper, ex } = await make({ config: { power: 'wlr-randr', output: 'DP-1' } });
  assert.equal((await call(helper, on(false))).status, 503);
  assert.equal(ex.calls.length, 0);
});

test('power none and nothing detected -> 503, no command', async () => {
  for (const config of [{ power: 'none' }, { power: undefined }]) {
    const { helper, ex } = await make({ config });
    assert.equal((await call(helper, on(false))).status, 503);
    assert.equal(ex.calls.length, 0);
  }
});

test('auto-detect probes for the binaries in order', async () => {
  const probe = async (have, extra = {}) => (await createHelper({ execFile: fakeExec().execFile, thermalPath: thermal, env: {}, which: (b) => have.includes(b), ...extra })).power;
  assert.equal((await probe(['cec-ctl', 'cec-client'])), 'cec-ctl');
  assert.equal((await probe(['cec-client'])), 'cec-client');
  assert.equal((await probe([])), null);
  assert.equal((await probe(['wlr-randr'])), null, 'wlr-randr needs an output name');
  assert.equal((await probe(['wlr-randr'], { output: 'HDMI-A-1' })), 'wlr-randr');
});

// ---- body validation -------------------------------------------------------
test('non-boolean or missing on -> 400 and no command', async () => {
  const { helper, ex } = await make();
  for (const body of [{ on: 'yes' }, { on: 1 }, { on: 0 }, { on: null }, {}, [], 'null', '{bad json', '"x"', '']) {
    assert.equal((await call(helper, { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call(helper, {})).status, 400, 'no body at all');
  assert.equal((await call(helper, { body: { on: true, argv: ['x'], cmd: 'rm -rf /' } })).status, 200, 'extra keys are ignored');
  assert.deepEqual(ex.calls.map((c) => c.file), ['cec-ctl']);
  assert.deepEqual(ex.calls[0].args, ['-d', '/dev/cec0', '--to', '0', '--image-view-on']);
});

test('an oversized body is refused and runs nothing', async () => {
  const { helper, ex } = await make();
  const r = await call(helper, { body: JSON.stringify({ on: true, pad: 'x'.repeat(5000) }) });
  assert.equal(r.status, 413);
  assert.equal(ex.calls.length, 0);
  assert.match(json(r).error, /too large.*1024/);
  assert.equal((await call(helper, { body: JSON.stringify({ on: true, pad: 'x'.repeat(900) }) })).status, 200, 'under the limit still works');
});

test('a body that errors mid-read is a 400, not a 413', async () => {
  const { helper, ex } = await make();
  const r = await new Promise((ok) => {
    const req = new Readable({ read() { this.destroy(new Error('aborted')); } });
    Object.assign(req, { method: 'POST', url: '/__helper/display', headers: { host: 'localhost', 'x-poster-helper': '1' }, socket: { remoteAddress: '127.0.0.1' } });
    helper.handle(req, { writeHead(status) { this.status = status; }, end() { ok({ status: this.status }); } });
  });
  assert.equal(r.status, 400);
  assert.equal(ex.calls.length, 0);
});

// ---- guards ---------------------------------------------------------------
test('non-loopback peer, missing header, hostile Host -> 403 and no command', async () => {
  const { helper, ex } = await make();
  const cases = [
    { peer: '192.168.1.5' },
    { peer: '::ffff:192.168.1.5' },
    { peer: null },
    { poster: false },
    { headers: { 'x-poster-helper': '0' }, poster: false },
    { headers: { 'x-poster-helper': 'true' }, poster: false },
    { host: 'evil.example' },
    { host: 'localhost.evil.com' },
    { host: 'localhost@evil.example' },
    { host: null },
    { headers: { 'content-type': 'text/plain' }, poster: false }, // CSRF simple request
  ];
  for (const c of cases) {
    for (const [method, url] of [['POST', '/__helper/display'], ['GET', '/__helper/status']]) {
      const r = await call(helper, { ...on(false), method, url, ...c });
      assert.equal(r.status, 403, `${method} ${url} ${JSON.stringify(c)}`);
    }
  }
  assert.equal(ex.calls.length, 0);
});

test('X-Forwarded-For / Forwarded from a non-loopback peer is still 403', async () => {
  const { helper, ex } = await make();
  const r = await call(helper, { ...on(false), peer: '192.168.1.5', headers: { 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1', 'x-real-ip': '127.0.0.1' } });
  assert.equal(r.status, 403);
  assert.equal(ex.calls.length, 0);
});

test('Host localhost:8080, 127.0.0.1 and [::1] are accepted; ::1 and mapped peers too', async () => {
  const { helper } = await make();
  for (const host of ['localhost:8080', 'localhost', '127.0.0.1:3000', '[::1]:8080']) {
    assert.equal((await call(helper, { ...on(true), host })).status, 200, host);
  }
  for (const peer of ['::1', '::ffff:127.0.0.1', '127.0.0.5']) {
    assert.equal((await call(helper, { ...on(true), peer })).status, 200, peer);
  }
});

test('no CORS grant, and OPTIONS preflight is never answered with one', async () => {
  const { helper } = await make();
  const r = await call(helper, { method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' } });
  assert.notEqual(r.status, 200);
  assert.notEqual(r.status, 204);
});

// ---- routes ------------------------------------------------------------
test('status lists the strategy and tempC from the thermal file', async () => {
  const { helper } = await make();
  const r = await call(helper, { method: 'GET', url: '/__helper/status' });
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), { power: 'cec-ctl', temperature: 'thermal_zone0', tempC: 48.3 });
});

test('status reports null power and null tempC when nothing is available', async () => {
  const { helper } = await make({ config: { power: 'none', thermalPath: join(dir, 'missing') } });
  assert.deepEqual(json(await call(helper, { method: 'GET', url: '/__helper/status' })), { power: null, temperature: null, tempC: null });
  writeFileSync(join(dir, 'junk'), 'hot\n');
  const { helper: h2 } = await make({ config: { thermalPath: join(dir, 'junk') } });
  assert.equal(json(await call(h2, { method: 'GET', url: '/__helper/status' })).tempC, null);
});

test('temperature falls back to vcgencmd measure_temp (fixed argv, PATH-only env)', async () => {
  const calls = [];
  const execFile = (f, a, o, cb) => { calls.push({ f, a, o }); setImmediate(() => cb(null, "temp=48.3'C\n", '')); return { pid: 1, stdin: { end() {} }, kill() {} }; };
  const helper = await createHelper({ execFile, thermalPath: join(dir, 'missing'), power: 'none', which: () => false, env: { PATH: '/p', PLEX_TOKEN: 'SECRET' } });
  assert.deepEqual(json(await status(helper)), { power: null, temperature: 'vcgencmd', tempC: 48.3 });
  assert.deepEqual(calls.map((c) => [c.f, c.a, c.o.env, c.o.shell, c.o.timeout]), [['vcgencmd', ['measure_temp'], { PATH: '/p' }, false, 5000]]);
});

test('thermal_zone0 wins over vcgencmd, which is not even run', async () => {
  const { helper, ex } = await make();
  assert.equal(json(await status(helper)).temperature, 'thermal_zone0');
  assert.equal(ex.calls.length, 0);
});

test('vcgencmd garbage, failure or hang -> temperature null', { timeout: 5000 }, async () => {
  const mk = (cb, extra = {}) => createHelper({ execFile: (f, a, o, done) => { cb(done); return { pid: 1, stdin: { end() {} }, kill() {} }; },
    thermalPath: join(dir, 'missing'), power: 'none', which: () => false, env: {}, ...extra });
  for (const out of ["temp=hot'C", "temp=48.3'C; reboot", 'x', '']) {
    const h = await mk((done) => setImmediate(() => done(null, out, '')));
    assert.deepEqual(json(await status(h)), { power: null, temperature: null, tempC: null }, out);
  }
  const failing = await mk((done) => setImmediate(() => done(new Error('nope'), "temp=48.3'C", '')));
  assert.equal(json(await status(failing)).tempC, null);
  const hung = await mk(() => {}, { timeoutMs: 40 });
  assert.equal(json(await status(hung)).tempC, null, 'a hung vcgencmd times out');
});

test('vcgencmd shares the one-command lock: no second command while a display command runs', { timeout: 5000 }, async () => {
  const { helper, ex } = await make({ exec: { hang: true }, config: { timeoutMs: 200, thermalPath: join(dir, 'missing') } });
  const first = call(helper, on(false));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(json(await status(helper)), { power: 'cec-ctl', temperature: null, tempC: null });
  assert.equal(ex.calls.length, 1, 'vcgencmd did not run');
  await first;
});

test('brightness and unknown helper routes are 404; wrong methods are 404', async () => {
  const { helper, ex } = await make();
  for (const [method, url] of [['POST', '/__helper/brightness'], ['GET', '/__helper/brightness'], ['POST', '/__helper/nope'],
    ['GET', '/__helper/display'], ['POST', '/__helper/status'], ['POST', '/__helper/calls'], ['GET', '/__helper/'], ['GET', '/__helper'],
    ['POST', '/__helper/display/'], ['POST', '/__helper/../display']]) {
    assert.equal((await call(helper, { method, url, ...on(true) })).status, 404, `${method} ${url}`);
  }
  assert.equal(ex.calls.length, 0);
});

test('paths outside /__helper/ are not handled', async () => {
  const { helper } = await make();
  for (const url of ['/', '/index.html', '/__helperx/status', '/x/__helper/status']) {
    assert.equal((await call(helper, { method: 'GET', url })).status, 'unhandled', url);
  }
});

test('query strings do not change the route', async () => {
  const { helper, ex } = await make();
  assert.equal((await call(helper, { url: '/__helper/display?x=1', ...on(false) })).status, 200);
  assert.equal(ex.calls.length, 1);
});

// ---- fake mode ----------------------------------------------------------
test('fake mode records calls, runs nothing and serves GET /__helper/calls', async () => {
  const { helper, ex } = await make({ config: { fake: true, power: undefined } });
  assert.deepEqual(json(await call(helper, { method: 'GET', url: '/__helper/calls' })), []);
  await call(helper, on(false));
  await call(helper, on(true));
  assert.equal((await call(helper, { ...on('yes') })).status, 400);
  const calls = json(await call(helper, { method: 'GET', url: '/__helper/calls' }));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => [c.action, c.on]), [['display', false], ['display', true]]);
  for (const c of calls) {
    assert.deepEqual(Object.keys(c).sort(), ['action', 'at', 'on']);
    assert.ok(Number.isFinite(Date.parse(c.at)) || Number.isFinite(c.at));
  }
  assert.equal(ex.calls.length, 0);
  const s = json(await call(helper, { method: 'GET', url: '/__helper/status' }));
  assert.equal(typeof s.tempC, 'number');
  assert.equal(s.power, 'fake');
});

test('fake mode status never reports the host-detected strategy; an explicit power flag wins', async () => {
  const h = await createHelper({ execFile: fakeExec().execFile, thermalPath: thermal, fake: true, which: () => true, env: {} });
  assert.deepEqual(json(await status(h)), { power: 'fake', temperature: 'thermal_zone0', tempC: 42.5 });
  assert.equal(h.power, 'fake');
  const h2 = await createHelper({ execFile: fakeExec().execFile, thermalPath: thermal, fake: true, power: 'cec-client', which: () => true, env: {} });
  assert.equal(json(await status(h2)).power, 'cec-client');
});

test('fake mode keeps only the last 100 calls', async () => {
  const { helper } = await make({ config: { fake: true } });
  for (let i = 0; i < 130; i++) await call(helper, on(i % 2 === 0));
  const calls = json(await call(helper, { method: 'GET', url: '/__helper/calls' }));
  assert.equal(calls.length, 100);
  assert.equal(calls[0].on, true, 'call 30 (even) is the oldest kept');
  assert.equal(calls[99].on, false, 'call 129 (odd) is the newest');
});

test('calls is 404 without fake mode, and guarded with it', async () => {
  const { helper } = await make();
  assert.equal((await call(helper, { method: 'GET', url: '/__helper/calls' })).status, 404);
  const { helper: f } = await make({ config: { fake: true } });
  for (const c of [{ peer: '10.0.0.2' }, { poster: false }, { host: 'evil.example' }]) {
    assert.equal((await call(f, { method: 'GET', url: '/__helper/calls', ...c })).status, 403, JSON.stringify(c));
  }
});

// ---- hostile configuration ------------------------------------------------
test('invalid flag / env values are refused at startup', async () => {
  const base = { execFile: fakeExec().execFile, thermalPath: thermal, which: () => false };
  const bad = [
    { power: 'sh' }, { power: 'wlr-randr' }, // wlr-randr without output
    { power: 'wlr-randr', output: '--off' }, { power: 'wlr-randr', output: '-x' }, { power: 'wlr-randr', output: 'a b' },
    { power: 'wlr-randr', output: 'a;rm -rf /' }, { power: 'wlr-randr', output: '$(id)' }, { power: 'wlr-randr', output: 'a\nb' },
    { power: 'wlr-randr', output: '' }, { power: 'wlr-randr', output: 'x'.repeat(65) },
    { power: 'wlr-randr', output: 'DP-1', waylandDisplay: '../x' }, { power: 'wlr-randr', output: 'DP-1', waylandDisplay: '-x' },
    { power: 'wlr-randr', output: 'DP-1', xdgRuntimeDir: 'relative' }, { power: 'wlr-randr', output: 'DP-1', xdgRuntimeDir: '/run/../etc' },
    { power: 'wlr-randr', output: 'DP-1', xdgRuntimeDir: '/run/user/1000\nX=1' }, { power: 'wlr-randr', output: 'DP-1', xdgRuntimeDir: '/a b' },
    { power: 'wlr-randr', output: 'DP-1', env: { WAYLAND_DISPLAY: 'x;y' } },
    { power: 'wlr-randr', output: 'DP-1', env: { XDG_RUNTIME_DIR: '/run/\0x' } },
  ];
  for (const b of bad) await assert.rejects(createHelper({ ...base, env: {}, ...b }), JSON.stringify(b));
});

// ---- timeout and lock -----------------------------------------------------
test('a hung command is killed after the timeout and the lock is released', { timeout: 5000 }, async () => {
  const { helper, ex } = await make({ exec: { hang: true }, config: { timeoutMs: 50 } });
  const r = await call(helper, on(false));
  assert.equal(r.status, 504);
  assert.equal(ex.calls[0].killed, true);
  assert.ok(ex.calls[0].opts.timeout > 0);
  const r2 = await call(helper, on(true));
  assert.equal(r2.status, 504, 'a second command is allowed to start (and times out too)');
  assert.equal(ex.calls.length, 2);
});

test('commands are spawned detached; on timeout the process group is killed before the lock is released', { timeout: 5000 }, async () => {
  const killed = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const { helper, ex } = await make({ exec: { hang: true, pid: 4242 }, config: { timeoutMs: 40, killGroup: async (pid) => { killed.push(pid); await gate; } } });
  assert.equal(ex.calls.length, 0);
  const first = call(helper, on(false));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(ex.calls[0].opts.detached, true);
  assert.deepEqual(killed, [4242]);
  assert.equal((await call(helper, on(true))).status, 503, 'group not gone yet: still locked');
  release();
  assert.equal((await first).status, 504);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await call(helper, on(true))).status, 504, 'lock released after the group is gone');
});

// Anything a test leaves running is killed at the end, so a regression cannot keep the test process alive.
const strays = [];
after(() => { for (const p of strays) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } });

const alive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) [ZX]/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};

test('a real hung command that forks a grandchild is killed with it within the timeout', { timeout: 15000 }, async () => {
  const bin = mkdtempSync(join(dir, 'bin-'));
  const pidfile = join(bin, 'grandchild.pid');
  writeFileSync(join(bin, 'cec-ctl'), `#!/bin/sh\nsleep 30 &\necho $! > ${pidfile}\nwait\n`);
  chmodSync(join(bin, 'cec-ctl'), 0o755);
  const helper = await createHelper({ thermalPath: thermal, power: 'cec-ctl', which: () => false, env: { PATH: `${bin}:/usr/bin:/bin` }, timeoutMs: 600 });
  const t0 = Date.now();
  const r = await call(helper, on(false));
  assert.equal(r.status, 504);
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  assert.ok(existsSync(pidfile), 'the fake binary ran and forked');
  const gc = Number(readFileSync(pidfile, 'utf8'));
  strays.push(gc);
  assert.ok(gc > 1);
  for (let i = 0; i < 100 && alive(gc); i++) await new Promise((ok) => setTimeout(ok, 20)); // the 504 does not wait for the group
  assert.equal(alive(gc), false, 'grandchild is dead');
  // lock released once the group is gone: the next command runs (and hangs and times out) rather than getting 503
  let second = await call(helper, on(true));
  for (let i = 0; i < 100 && second.status === 503; i++) { await new Promise((ok) => setTimeout(ok, 20)); second = await call(helper, on(true)); }
  assert.equal(second.status, 504);
  for (let i = 0; i < 100 && alive(Number(readFileSync(pidfile, 'utf8'))); i++) await new Promise((ok) => setTimeout(ok, 20));
  const last = Number(readFileSync(pidfile, 'utf8'));
  strays.push(last);
  assert.equal(alive(last), false);
});

test('the real default executor runs the binary directly, with no shell (argv literal, env exactly PATH)', async () => {
  // No execFile injection: this drives realExecFile. The fake cec-ctl is a node script that records its argv,
  // and its environment keys. A shell (shell: true) would add PWD / SHLVL / _ to the
  // environment and join the argv into one command line, so exact equality here fails under shell: true.
  const bin = mkdtempSync(join(dir, 'bin-'));
  const out = join(bin, 'seen.json');
  const marker = join(bin, 'marker');
  writeFileSync(join(bin, 'cec-ctl'),
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env).sort() }));\n`);
  chmodSync(join(bin, 'cec-ctl'), 0o755);
  const helper = await createHelper({ thermalPath: thermal, power: 'cec-ctl', which: () => false, env: { PATH: bin, PLEX_TOKEN: 'SECRET' } });
  const r = await call(helper, { body: { on: false, argv: [`;touch ${marker}`], cmd: `touch ${marker}` } });
  assert.equal(r.status, 200);
  const seen = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(seen.argv, ['-d', '/dev/cec0', '--to', '0', '--standby']);
  assert.deepEqual(seen.env, ['PATH'], 'child environment is PATH only; a shell would add variables');
  assert.equal(existsSync(marker), false, 'nothing from the request body ran');
});

test('the default timeout is 5 seconds', async () => {
  const { helper, ex } = await make();
  await call(helper, on(false));
  assert.equal(ex.calls[0].opts.timeout, 5000);
});

test('one command at a time: a concurrent request is refused while one runs', { timeout: 5000 }, async () => {
  const { helper, ex } = await make({ exec: { hang: true }, config: { timeoutMs: 300 } });
  const first = call(helper, on(false));
  await new Promise((r) => setTimeout(r, 30));
  const second = await call(helper, on(true));
  assert.equal(second.status, 503);
  assert.equal(ex.calls.length, 1);
  assert.equal((await first).status, 504);
});

test('a failing command -> 502 and the lock is released', async () => {
  const calls = [];
  const execFile = (f, a, o, cb) => { calls.push(f); setImmediate(() => cb(new Error('boom: SECRET'), '', 'stderr SECRET')); return { stdin: { end() {} }, kill() {} }; };
  const helper = await createHelper({ execFile, thermalPath: thermal, power: 'cec-ctl', which: () => false, env: {} });
  const r = await call(helper, on(false));
  assert.equal(r.status, 502);
  assert.ok(!r.body.includes('SECRET'), 'command output is not echoed');
  assert.equal((await call(helper, on(false))).status, 502);
  assert.equal(calls.length, 2);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stubBin(script) {
  const bin = mkdtempSync(join(dir, 'bin-'));
  writeFileSync(join(bin, 'cec-ctl'), script);
  chmodSync(join(bin, 'cec-ctl'), 0o755);
  return bin;
}
const realHelper = (bin, extra = {}) => createHelper({ thermalPath: thermal, power: 'cec-ctl', which: () => false, env: { PATH: `${bin}:/usr/bin:/bin` }, ...extra });

test('the real executor maps a non-zero exit to 502 with the fixed error body, and frees the lock', async () => {
  const helper = await realHelper(stubBin('#!/bin/sh\nexit 3\n'));
  const r = await call(helper, on(false));
  assert.equal(r.status, 502);
  assert.deepEqual(json(r), { error: 'command failed' });
  assert.equal((await call(helper, on(true))).status, 502, 'lock released, the next command runs');
  const missing = await realHelper(mkdtempSync(join(dir, 'empty-')), { env: { PATH: '/nonexistent' } });
  assert.equal((await call(missing, on(false))).status, 502, 'a binary that cannot be started is a 502 too');
});

test('after every command, success or failure, its process group is killed before the lock is released', { timeout: 15000 }, async () => {
  for (const [code, want] of [[0, 200], [3, 502]]) {
    const bin = mkdtempSync(join(dir, 'bin-'));
    const pidfile = join(bin, 'bg.pid');
    writeFileSync(join(bin, 'cec-ctl'), `#!/bin/sh\nsleep 30 >/dev/null 2>&1 &\necho $! > ${pidfile}\nexit ${code}\n`);
    chmodSync(join(bin, 'cec-ctl'), 0o755);
    const helper = await realHelper(bin);
    const r = await call(helper, on(false));
    assert.equal(r.status, want, `exit ${code}`);
    const bg = Number(readFileSync(pidfile, 'utf8'));
    strays.push(bg);
    assert.ok(bg > 1);
    assert.equal(alive(bg), false, `exit ${code}: the backgrounded sleep did not outlive the command`);
    assert.equal((await call(helper, on(true))).status, want, 'lock released');
  }
});

test('the 504 is sent when the timeout fires; the lock is kept until the process group is gone', { timeout: 5000 }, async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { helper } = await make({ exec: { hang: true, pid: 4242 }, config: { timeoutMs: 40, killGroup: () => gate } });
  const first = call(helper, on(false));
  const early = await Promise.race([first, sleep(500).then(() => 'held')]);
  try {
    assert.notEqual(early, 'held', 'the response was held back until the group was gone');
    assert.equal(early.status, 504);
    assert.equal((await call(helper, on(true))).status, 503, 'group not gone yet: still locked');
  } finally { release(); }
  await first;
  await sleep(30);
  assert.equal((await call(helper, on(true))).status, 504, 'lock released once the group is gone');
});

test('the lock is held while any group member is alive and released when none is', { timeout: 5000 }, async () => {
  let live = true;
  const warned = [];
  const killGroup = (pid) => killProcessGroup(pid, { kill() {}, alive: async () => live, stepMs: 5, warn: (m) => warned.push(m) });
  const { helper } = await make({ exec: { hang: true, pid: 4242 }, config: { timeoutMs: 40, killGroup } });
  assert.equal((await call(helper, on(false))).status, 504);
  await sleep(100);
  assert.equal((await call(helper, on(true))).status, 503, 'a member is still alive: locked');
  live = false;
  await sleep(100);
  assert.equal((await call(helper, on(true))).status, 504, 'no member left: lock released');
  assert.deepEqual(warned, []);
});

test('killProcessGroup signals the whole group, waits while it is alive, and ignores an already-gone group', { timeout: 5000 }, async () => {
  let live = true;
  const kills = [];
  let done = false;
  const p = killProcessGroup(777, { kill: (...a) => { kills.push(a); }, alive: async () => live, stepMs: 5, maxMs: 5000, warn() {} }).then(() => { done = true; });
  await sleep(60);
  assert.equal(done, false, 'still waiting: a member is alive');
  live = false;
  await Promise.race([p, sleep(1000)]);
  assert.equal(done, true);
  assert.deepEqual(kills, [[-777, 'SIGKILL']]);
  const none = [];
  for (const bad of [undefined, null, 0, 1, -5, 1.5, NaN, '9']) await killProcessGroup(bad, { kill: (...a) => none.push(a) });
  assert.deepEqual(none, [], 'never signals pid <= 1 or a non-integer (that would hit every process)');
  let polled = 0;
  await killProcessGroup(778, { kill: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); }, alive: async () => { polled++; return true; }, warn() {} });
  assert.equal(polled, 0, 'ESRCH: already gone, nothing to wait for');
});

test('killProcessGroup gives up after maxMs, logs a warning naming the pgid, and returns', { timeout: 5000 }, async (t) => {
  const warned = [];
  let stop = false;
  t.after(() => { stop = true; }); // runs when the test times out too, so a regressed deadline cannot keep the process alive
  const t0 = Date.now();
  await killProcessGroup(4321, { kill() {}, alive: async () => !stop, stepMs: 5, maxMs: 80, warn: (m) => warned.push(m) });
  assert.ok(Date.now() - t0 >= 70, 'waited for the bound');
  assert.equal(warned.length, 1);
  assert.match(warned[0], /4321/);
  assert.match(warned[0], /process group/);
});

test('a group whose only remaining members are zombies counts as gone', { timeout: 15000 }, async () => {
  // setsid makes the short-lived sleep its own group leader; its parent (the sleep 60 that sh execs into) never reaps it,
  // so the group is exactly one zombie. kill(-pgid, 0) still succeeds on it.
  const holder = spawn('sh', ['-c', 'setsid sleep 0.1 & echo $!; exec sleep 60'], { stdio: ['ignore', 'pipe', 'ignore'] });
  strays.push(holder.pid);
  const pgid = Number(await new Promise((ok) => holder.stdout.once('data', (c) => ok(String(c).trim()))));
  strays.push(pgid);
  await sleep(400);
  assert.doesNotThrow(() => process.kill(-pgid, 0), 'precondition: the zombie keeps the group visible to signal 0');
  const warned = [];
  const t0 = Date.now();
  await killProcessGroup(pgid, { maxMs: 3000, warn: (m) => warned.push(m) });
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  assert.deepEqual(warned, []);
  holder.kill('SIGKILL');
});

test('the real liveness check sees a live group member: a SIGKILL that does nothing ends in the bounded wait and a warning', { timeout: 5000 }, async (t) => {
  // No `alive` seam: this drives groupAlive and its /proc scan. The kill wrapper turns SIGKILL into a no-op and passes
  // signal 0 through, so the detached sleep really is still running when the wait begins.
  const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  strays.push(child.pid);
  // Runs when the test times out too: the real SIGKILL ends the wait, so a regressed deadline cannot keep the process alive.
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } });
  const warned = [];
  const kill = (p, sig) => (sig === 'SIGKILL' ? undefined : process.kill(p, sig));
  const t0 = Date.now();
  await killProcessGroup(child.pid, { kill, maxMs: 300, warn: (m) => warned.push(m) });
  const took = Date.now() - t0;
  assert.ok(took >= 290, `returned after ${took} ms: the live member was not seen, so the wait did not last until maxMs`);
  assert.ok(took < 3000, `took ${took} ms`);
  assert.equal(warned.length, 1);
  assert.ok(warned[0].includes(`process group ${child.pid} `), warned[0]);
  assert.equal(alive(child.pid), true, 'the sleep was still running when the wait ended');
});

// ---- integration: serve.mjs --helper ----------------------------------------
function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}
const root = mkdtempSync(join(tmpdir(), 'helper-root-'));
writeFileSync(join(root, 'index.html'), 'INDEX');

async function spawnServer(extra) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await freePort();
    const c = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(p), '--root', root, ...extra], {
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
function http(port, method, path, { headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => ok({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', fail);
    req.end(body);
  });
}
const H = { 'X-Poster-Helper': '1' };

test('integration: serve.mjs --helper --helper-fake', async () => {
  const { child, port } = await spawnServer(['--helper', '--helper-fake']);
  try {
    assert.equal((await http(port, 'GET', '/__helper/status', { headers: H })).status, 200);
    assert.equal((await http(port, 'GET', '/__helper/status')).status, 403);
    assert.equal((await http(port, 'GET', '/__helper/status', { headers: { ...H, Host: 'evil.example' } })).status, 403);
    assert.equal((await http(port, 'POST', '/__helper/display', { headers: { 'Content-Type': 'text/plain' }, body: '{"on":false}' })).status, 403);
    assert.equal((await http(port, 'GET', '/__helper/calls', { headers: H })).body, '[]');
    const d = await http(port, 'POST', '/__helper/display', { headers: { ...H, 'Content-Type': 'application/json' }, body: '{"on":false}' });
    assert.equal(d.status, 200);
    const calls = JSON.parse((await http(port, 'GET', '/__helper/calls', { headers: H })).body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'display');
    assert.equal(calls[0].on, false);
    assert.equal((await http(port, 'GET', '/__helper/calls')).status, 403);
    assert.equal((await http(port, 'POST', '/__helper/brightness', { headers: H, body: '{}' })).status, 404);
    for (const r of [await http(port, 'GET', '/__helper/status', { headers: H }), await http(port, 'GET', '/__helper/status')]) {
      assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')));
    }
    assert.equal((await http(port, 'GET', '/index.html')).body, 'INDEX', 'static serving is unchanged');
  } finally { child.kill(); }
});

test('integration: an oversized body gets a real 413 over the socket, not a reset', async () => {
  const { child, port } = await spawnServer(['--helper', '--helper-fake']);
  try {
    for (const size of [2000, 200 * 1024]) {
      const r = await http(port, 'POST', '/__helper/display', { headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true, pad: 'x'.repeat(size) }) });
      assert.equal(r.status, 413, String(size));
      assert.match(JSON.parse(r.body).error, /too large/);
    }
    assert.equal((await http(port, 'GET', '/__helper/calls', { headers: H })).body, '[]', 'no command recorded');
    assert.equal((await http(port, 'GET', '/__helper/status', { headers: H })).status, 200, 'server still up');
  } finally { child.kill(); }
});

test('integration: fake-mode status is power fake, or the explicit flag', async () => {
  for (const [extra, want] of [[[], 'fake'], [['--helper-power', 'cec-client'], 'cec-client']]) {
    const { child, port } = await spawnServer(['--helper', '--helper-fake', ...extra]);
    try {
      assert.equal(JSON.parse((await http(port, 'GET', '/__helper/status', { headers: H })).body).power, want);
    } finally { child.kill(); }
  }
});

test('integration: --helper alone has no calls route', async () => {
  const { child, port } = await spawnServer(['--helper', '--helper-power', 'none']);
  try {
    assert.equal((await http(port, 'GET', '/__helper/calls', { headers: H })).status, 404);
    const s = await http(port, 'GET', '/__helper/status', { headers: H });
    assert.equal(s.status, 200);
    assert.equal(JSON.parse(s.body).power, null);
  } finally { child.kill(); }
});

test('integration: without --helper the routes do not exist', async () => {
  const { child, port } = await spawnServer([]);
  try {
    assert.equal((await http(port, 'GET', '/__helper/status', { headers: H })).status, 404);
    assert.equal((await http(port, 'POST', '/__helper/display', { headers: H, body: '{"on":false}' })).status, 404);
  } finally { child.kill(); }
});

test('integration: --helper-fake alone does not enable the helper; bad flag values refuse to start', async () => {
  const { child, port } = await spawnServer(['--helper-fake']);
  try {
    assert.equal((await http(port, 'GET', '/__helper/status', { headers: H })).status, 404);
  } finally { child.kill(); }
  const c = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(await freePort()), '--root', root,
    '--helper', '--helper-power', 'wlr-randr', '--helper-output', 'a;b'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
  const code = await new Promise((ok) => c.once('exit', ok));
  assert.notEqual(code, 0);
});

test('integration: a helper value option with no value refuses to start and names the option', { timeout: 15000 }, async () => {
  const cases = [
    [['--helper', '--helper-power', '--helper-fake'], '--helper-power'], // followed by another flag
    [['--helper', '--helper-fake', '--helper-power'], '--helper-power'], // last argument
    [['--helper', '--helper-output'], '--helper-output'],
    [['--helper', '--helper-wayland-display', '--helper-fake'], '--helper-wayland-display'],
    [['--helper', '--helper-xdg-runtime-dir', '--helper-fake'], '--helper-xdg-runtime-dir'],
  ];
  for (const [extra, name] of cases) {
    const c = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(await freePort()), '--root', root, ...extra],
      { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => c.kill('SIGKILL'), 4000); // a server that started anyway is stopped, and the test fails below
    const code = await new Promise((ok) => c.once('exit', (cd, sig) => ok(sig ? `killed by ${sig}: it started instead of refusing` : cd)));
    clearTimeout(timer);
    assert.ok(typeof code === 'number' && code !== 0, `${extra.join(' ')} -> ${code}`);
    assert.ok(err.includes(name), `stderr names ${name}: ${JSON.stringify(err)}`);
  }
});
