#!/usr/bin/env node
// Checks that sw.js's SHELL list and the files on disk agree:
//   - every SHELL entry exists ('./' is allowed without a file), and
//   - every file under js/ (recursively, so js/vendor/ counts) is listed.
//
//   node scripts/check-precache.mjs [--root <dir>]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const i = args.indexOf('--root');
const ROOT = resolve(i >= 0 && args[i + 1] ? args[i + 1] : fileURLToPath(new URL('..', import.meta.url)));

const src = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const block = src.match(/const SHELL = \[([\s\S]*?)\];/);
if (!block) {
  console.error('sw.js has no SHELL list');
  process.exit(1);
}
const list = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(ROOT, p).split(sep).join('/')];
  });

const missing = list.filter((p) => p !== './' && !existsSync(join(ROOT, p)));
const jsDir = join(ROOT, 'js');
const notPrecached = existsSync(jsDir) ? walk(jsDir).filter((f) => !list.includes(f)) : [];

if (missing.length || notPrecached.length) {
  console.error({ missing, notPrecached });
  process.exit(1);
}
console.log(`${list.length} precached files OK`);
