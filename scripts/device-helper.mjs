// Opt-in loopback device helper (serve.mjs --helper): switches display power and reads the
// CPU temperature on a Pi. Routes (only when enabled; otherwise they do not exist):
//
//   POST /__helper/display   {"on": true|false}   screen power
//   GET  /__helper/status    { power: <strategy>|null, temperature: <source>|null, tempC: <number>|null }
//                            temperature names where tempC came from: 'thermal_zone0', 'vcgencmd' or null
//   GET  /__helper/calls                          fake mode only: recorded calls, oldest first
//
// Guards, in order, on every route that exists: loopback socket peer, loopback Host
// (hostname only), and the custom header `X-Poster-Helper: 1`. The header forces a CORS
// preflight for any page script, and no CORS grant is ever sent, so a web page cannot make
// the browser call this. Proxy headers are never consulted.
// Commands are spawned (no shell) with fixed argv arrays, each in its own detached process group. One at a time,
// 5 s timeout. On timeout the 504 is sent at once and the command's whole process group is killed;
// the lock is kept until the group is gone (members that are only zombies count as gone; on Linux
// they are read from /proc/<pid>/stat). If the group is still alive after 10 s, a warning naming the
// pgid is logged and the lock is released anyway. After every command, success or failure, its
// process group is killed and waited for the same way, so nothing it forked outlives the lock.
// Hazard: a reverse proxy on this machine makes every client look like loopback.

import { spawn } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { isLoopback, isLoopbackHost } from './net.mjs';

const PREFIX = '/__helper/';
const MAX_BODY = 1024;
const TIMEOUT_MS = 5000;
const STRATEGIES = ['cec-ctl', 'cec-client', 'wlr-randr', 'none'];
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/; // output / display names; never starts with '-'
const DIR = /^\/[A-Za-z0-9_.\/-]*$/; // absolute, no spaces, newlines or NULs
const THERMAL = '/sys/class/thermal/thermal_zone0/temp';
const MAX_CALLS = 100;
const MAX_STDOUT = 65536;
const GROUP_WAIT_MS = 10000; // how long to wait for a killed process group to disappear
const DRAIN_MS = 2000; // how long an oversized request body may keep arriving after the 413
const VCGENCMD_TEMP = /^temp=(-?\d{1,3}(?:\.\d{1,2})?)'C$/;

// Is anything in process group `pgid` still running? Signal 0 succeeds on zombies, so on Linux
// each member's state is read from /proc/<pid>/stat and a group of zombies counts as gone
// (a zombie is reaped by its parent, or by init, and runs nothing).
async function groupAlive(pgid, kill) {
  try { kill(-pgid, 0); } catch { return false; }
  let names;
  try { names = await readdir('/proc'); } catch { return true; } // no /proc: signal 0 is all there is
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue;
    try {
      const m = (await readFile(`/proc/${n}/stat`, 'utf8')).match(/^\d+ \(.*\) (\S) -?\d+ (-?\d+)/s); // state, ppid, pgrp
      if (m && Number(m[2]) === pgid && m[1] !== 'Z') return true;
    } catch { /* exited while we looked */ }
  }
  return false;
}

// Kill a command's process group (the child was spawned detached, so pgid == pid) and wait
// until the group is gone, so a forked grandchild cannot outlive the lock. After `maxMs` the
// wait ends with a warning naming the pgid. Options are test seams.
export async function killProcessGroup(pid, {
  kill = (p, sig) => process.kill(p, sig), alive = (pgid) => groupAlive(pgid, kill),
  maxMs = GROUP_WAIT_MS, stepMs = 20, warn = console.warn,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try { kill(-pid, 'SIGKILL'); } catch { return; } // ESRCH: already gone
  const deadline = Date.now() + maxMs;
  while (await alive(pid)) {
    if (Date.now() >= deadline) {
      warn(`device helper: process group ${pid} is still alive ${maxMs} ms after SIGKILL; releasing the lock`);
      return;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// Fixed argv per strategy. All command syntax is (verify) on real hardware.
const COMMANDS = {
  'cec-ctl': (on) => ({ file: 'cec-ctl', args: ['-d', '/dev/cec0', '--to', '0', on ? '--image-view-on' : '--standby'] }),
  'cec-client': (on) => ({ file: 'cec-client', args: ['-s', '-d', '1'], input: on ? 'on 0\n' : 'standby 0\n' }),
  'wlr-randr': (on, cfg) => ({ file: 'wlr-randr', args: ['--output', cfg.output, on ? '--on' : '--off'] }),
};

// execFile-shaped (file, args, opts, cb) -> child, built on spawn because node's execFile drops
// `detached`, and a detached child (its own process group) is what lets a timeout kill the
// command together with anything it forked. No shell, ever; stderr is discarded.
function realExecFile(file, args, opts, cb) {
  const child = spawn(file, args, { env: opts.env, shell: false, detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  let called = false;
  const finish = (err) => { if (!called) { called = true; cb(err, out, ''); } };
  child.stdout.on('data', (c) => { if (out.length < MAX_STDOUT) out += c.toString('utf8'); });
  child.once('error', finish);
  child.once('close', (code) => finish(code === 0 ? null : new Error(`exit ${code}`)));
  return child;
}

async function defaultWhich(bin) {
  for (const d of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    try { await access(join(d, bin), constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

function check(label, value, ...res) {
  if (typeof value !== 'string' || !res.some((re) => re.test(value)) || value.split('/').includes('..')) {
    throw new Error(`device helper: invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

// Async so auto-detection (probing PATH for the binaries) finishes, and bad flag or env
// values reject, before the server starts listening.
export async function createHelper({
  execFile = realExecFile, thermalPath = THERMAL, power, output, waylandDisplay, xdgRuntimeDir,
  fake = false, env = process.env, which = defaultWhich, timeoutMs = TIMEOUT_MS, killGroup = killProcessGroup,
} = {}) {
  if (power !== undefined && !STRATEGIES.includes(power)) throw new Error(`device helper: invalid power strategy: ${JSON.stringify(power)}`);
  if (output !== undefined) check('output name', output, NAME);
  if (waylandDisplay !== undefined) check('wayland display', waylandDisplay, NAME, DIR); // bare name or absolute socket path
  if (xdgRuntimeDir !== undefined) check('XDG runtime dir', xdgRuntimeDir, DIR);

  let strategy = null; // resolved strategy, or null
  if (power && power !== 'none') strategy = power;
  else if (!power && !fake) { // fake mode never probes the host
    // Auto-detect by probing for the binaries. wlr-randr needs an output name, so it is
    // only considered when one was given.
    for (const bin of ['cec-ctl', 'cec-client', ...(output ? ['wlr-randr'] : [])]) {
      if (await which(bin)) { strategy = bin; break; }
    }
  }
  // Compositor environment for wlr-randr: flags, else this process's environment.
  let wlrEnv = null;
  if (strategy === 'wlr-randr') {
    if (!output) throw new Error('device helper: --helper-output is required for wlr-randr');
    const wd = waylandDisplay ?? env.WAYLAND_DISPLAY;
    const xd = xdgRuntimeDir ?? env.XDG_RUNTIME_DIR;
    if (wd !== undefined) check('WAYLAND_DISPLAY', wd, NAME, DIR);
    if (xd !== undefined) check('XDG_RUNTIME_DIR', xd, DIR);
    if (wd && xd) wlrEnv = { WAYLAND_DISPLAY: wd, XDG_RUNTIME_DIR: xd };
  }
  const cfg = { output, env: wlrEnv };

  const calls = [];
  let busy = false;

  const send = (res, status, data, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(data));
  };
  const guarded = (req) =>
    isLoopback(req.socket?.remoteAddress) && isLoopbackHost(req.headers.host) && req.headers['x-poster-helper'] === '1';

  // Resolves { text } or { error: 'large' | 'read' }. On overflow the rest of the body is read
  // and discarded (not destroyed) so the client still receives the 413.
  function readBody(req) {
    return new Promise((ok) => {
      const chunks = [];
      let size = 0;
      let settled = false;
      const settle = (r) => { if (!settled) { settled = true; ok(r); } };
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { chunks.length = 0; settle({ error: 'large' }); return; }
        chunks.push(c);
      });
      req.on('end', () => settle({ text: Buffer.concat(chunks).toString('utf8') }));
      req.on('error', () => settle({ error: 'read' }));
      req.on('close', () => settle({ error: 'read' }));
    });
  }

  // Resolves { result: 'ok' | 'error' | 'timeout', stdout, gone }. The command is spawned detached
  // (its own process group). Its group is killed and waited for after every command. On timeout the
  // result is returned at once and `gone` is a promise for the group being gone (never rejects); the
  // caller holds the lock until then. Otherwise the wait is done before returning and `gone` is null.
  function run({ file, args, input, env: cenv }) {
    return new Promise((ok) => {
      let done = false;
      let child;
      const finish = async (result, stdout = '') => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (result === 'timeout') {
          try { child?.kill('SIGKILL'); } catch { /* already gone */ }
          ok({ result, stdout, gone: Promise.resolve().then(() => killGroup(child?.pid)).catch(() => {}) });
          return;
        }
        try { await killGroup(child?.pid); } catch { /* already gone */ }
        ok({ result, stdout, gone: null });
      };
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      try {
        child = execFile(file, args, { env: cenv, timeout: timeoutMs, killSignal: 'SIGKILL', shell: false, detached: true, windowsHide: true },
          (err, stdout) => finish(!err ? 'ok' : err.killed ? 'timeout' : 'error', typeof stdout === 'string' ? stdout : ''));
        child?.stdin?.on?.('error', () => {});
        child?.stdin?.end?.(input);
      } catch { finish('error'); }
    });
  }

  // Release the lock now, or (after a timeout) once the killed group is gone.
  const unlock = (out) => { if (out?.gone) out.gone.then(() => { busy = false; }); else busy = false; };

  const childEnv = () => ({ PATH: env.PATH || '/usr/local/bin:/usr/bin:/bin' });

  // thermal_zone0 (millidegrees), else `vcgencmd measure_temp` ("temp=48.3'C").
  async function readTemp() {
    try {
      const t = (await readFile(thermalPath, 'utf8')).trim();
      if (/^-?\d{1,7}$/.test(t)) return { temperature: 'thermal_zone0', tempC: Math.round(Number(t) / 100) / 10 };
    } catch { /* fall back */ }
    if (busy) return { temperature: null, tempC: null }; // one command at a time, status included
    busy = true;
    let out;
    try {
      out = await run({ file: 'vcgencmd', args: ['measure_temp'], env: childEnv() });
      const m = out.result === 'ok' ? out.stdout.trim().match(VCGENCMD_TEMP) : null;
      if (m) return { temperature: 'vcgencmd', tempC: Math.round(Number(m[1]) * 10) / 10 };
    } finally { unlock(out); }
    return { temperature: null, tempC: null };
  }

  async function display(req, res) {
    const got = await readBody(req);
    if (got.error === 'large') {
      const t = setTimeout(() => req.destroy?.(), DRAIN_MS);
      t.unref?.();
      req.once?.('close', () => clearTimeout(t));
      return send(res, 413, { error: `body too large (limit ${MAX_BODY} bytes)` }, { Connection: 'close' });
    }
    if (got.error) return send(res, 400, { error: 'request body could not be read' });
    let body;
    try { body = JSON.parse(got.text); } catch { return send(res, 400, { error: 'body must be JSON' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.on !== 'boolean') {
      return send(res, 400, { error: '"on" must be true or false' });
    }
    const on = body.on;
    if (fake) {
      calls.push({ action: 'display', on, at: new Date().toISOString() });
      if (calls.length > MAX_CALLS) calls.splice(0, calls.length - MAX_CALLS);
      return send(res, 200, { ok: true, on });
    }
    if (!strategy) return send(res, 503, { error: 'no power strategy available' });
    if (strategy === 'wlr-randr' && !cfg.env) return send(res, 503, { error: 'WAYLAND_DISPLAY and XDG_RUNTIME_DIR are required' });
    if (busy) return send(res, 503, { error: 'busy' });
    busy = true;
    let out;
    try {
      const cmd = COMMANDS[strategy](on, cfg);
      const base = childEnv();
      out = await run({ ...cmd, env: strategy === 'wlr-randr' ? { ...base, ...cfg.env } : base });
      if (out.result === 'ok') return send(res, 200, { ok: true, on });
      return send(res, out.result === 'timeout' ? 504 : 502, { error: out.result === 'timeout' ? 'command timed out' : 'command failed' });
    } finally { unlock(out); }
  }

  async function status(res) {
    if (fake) return send(res, 200, { power: power ?? 'fake', temperature: 'thermal_zone0', tempC: 42.5 });
    send(res, 200, { power: strategy, ...(await readTemp()) });
  }

  // Returns false when the URL is not under /__helper/ (serve.mjs carries on); otherwise
  // true, and the response is sent.
  function handle(req, res) {
    const path = (req.url || '').split(/[?#]/)[0];
    if (path !== PREFIX.slice(0, -1) && !path.startsWith(PREFIX)) return false;
    const notFound = () => send(res, 404, { error: 'not found' });
    const route = path.slice(PREFIX.length);
    const known =
      (req.method === 'POST' && route === 'display') ||
      (req.method === 'GET' && route === 'status') ||
      (req.method === 'GET' && route === 'calls' && fake);
    if (!known) { notFound(); return true; }
    if (!guarded(req)) { send(res, 403, { error: 'forbidden' }); return true; }
    const done = (p) => p.catch(() => send(res, 500, { error: 'internal error' }));
    if (route === 'display') done(display(req, res));
    else if (route === 'status') done(status(res));
    else send(res, 200, calls);
    return true;
  }

  return { handle, power: fake ? (power ?? 'fake') : strategy };
}
