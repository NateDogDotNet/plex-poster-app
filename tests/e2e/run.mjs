#!/usr/bin/env node
// Browser test runner.
//
//   node tests/e2e/run.mjs [spec-name ...]     # runs tests/e2e/<name>.spec.mjs (exact names)
//
// Starts one shared `serve.mjs --mock` on E2E_PORT (18080) / E2E_MOCK_PORT (18401), runs each spec
// in its own node process, prints one PASS/FAIL line per spec, kills the server, and exits
// non-zero if any spec failed. Concurrent worktrees set different ports through those variables.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_PORT, E2E_MOCK_PORT, spawnServe } from './lib.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const names = process.argv.slice(2);
const specs = names.length
  ? names
  : readdirSync(DIR).filter((f) => f.endsWith('.spec.mjs')).map((f) => f.slice(0, -'.spec.mjs'.length)).sort();

const TIMEOUT_MS = Number(process.env.E2E_SPEC_TIMEOUT || 180) * 1000;

const { child: server, ready } = spawnServe(['--mock', '--port', String(E2E_PORT), '--mock-port', String(E2E_MOCK_PORT)]);
let current = null; // the running spec child (its own process group)
const killGroup = (p) => {
  if (!p || !p.pid) return;
  try {
    process.kill(-p.pid, 'SIGKILL');
  } catch {}
};
const cleanup = () => {
  killGroup(current);
  server.kill();
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
try {
  await ready;
  for (const name of specs) {
    const file = join(DIR, `${name}.spec.mjs`);
    if (!existsSync(file)) {
      console.log(`FAIL ${name} (no such spec: ${file})`);
      failed++;
      continue;
    }
    let timedOut = false;
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [file], { stdio: 'inherit', env: process.env, detached: true });
      current = p;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup(p);
      }, TIMEOUT_MS);
      p.on('exit', (c) => {
        clearTimeout(timer);
        killGroup(p); // sweep stragglers (Chromium, dedicated server) left in the group
        current = null;
        resolve(timedOut ? 1 : (c ?? 1));
      });
    });
    console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name}${timedOut ? ' (timeout)' : ''}`);
    if (code !== 0) failed++;
  }
} catch (e) {
  console.error(e.message);
  failed++;
}
cleanup();
process.exit(failed ? 1 : 0);
