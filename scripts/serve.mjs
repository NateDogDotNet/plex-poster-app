#!/usr/bin/env node
// Zero-dependency static server for the app (localhost counts as a secure context,
// so the service worker and install prompt work without https).
//
//   node scripts/serve.mjs                 # http://localhost:8080
//   node scripts/serve.mjs --port 3000
//   node scripts/serve.mjs --host 0.0.0.0  # reachable from other devices on the LAN
//   node scripts/serve.mjs --mock          # plus a fake Plex server on :32401 for demos/tests
//   node scripts/serve.mjs --root <dir>    # serve <dir> instead of the repo root (tests)
//
// Only an allowlist of app paths is served. config.json (the Plex token) goes only to a
// loopback peer whose Host is localhost, 127.0.0.1 or [::1]; everything else is 404.
// The peer is the socket address; proxy headers are never consulted.
// Hazard: a reverse proxy on this machine makes every client look like loopback, so do
// not put one in front of this server.

import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { extname, join, resolve, sep, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopback, isLoopbackHost } from './net.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const ROOT = resolve(opt('root', fileURLToPath(new URL('..', import.meta.url))));
const PORT = Number(opt('port', process.env.PORT || 8080));
const HOST = opt('host', '127.0.0.1');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
// Allowlist: these files and everything under these directories. All else is 404.
const FILES = new Set(['/index.html', '/manifest.webmanifest', '/sw.js']);
const DIRS = ['/css/', '/js/', '/assets/'];
// An app path is on the allowlist and has no dotfile segment (even under css/, js/, assets/).
const isAppPath = (p) =>
  (FILES.has(p) || DIRS.some((d) => p.startsWith(d))) && !p.split('/').some((seg) => seg.startsWith('.'));
const REAL_ROOT = await realpath(ROOT).catch(() => ROOT);

createServer(async (req, res) => {
  try {
    // Normalise first (decode, resolve . and .., collapse //, strip trailing slash), check second.
    const raw = decodeURIComponent(req.url.split(/[?#]/)[0]);
    if (raw.includes('\0') || raw.includes('\\') || !raw.startsWith('/')) return send(res, 404, 'Not found');
    let path = posix.normalize(raw);
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    if (path.toLowerCase() === '/config.json') {
      // Only the exact spelling is ever served; case, dot-segment and slash variants are 404.
      if (raw !== '/config.json') return send(res, 404, 'Not found');
      if (!isLoopback(req.socket.remoteAddress) || !isLoopbackHost(req.headers.host)) return send(res, 403, 'Forbidden');
    } else {
      if (path === '/') path = '/index.html';
      if (!isAppPath(path)) return send(res, 404, 'Not found');
    }
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT + sep)) return send(res, 404, 'Not found');
    // A symlink whose real path leaves the root, or lands on a non-app file, is not an app path.
    const real = await realpath(file);
    const rel = '/' + relative(REAL_ROOT, real).split(sep).join('/');
    if (rel.startsWith('/..') || (path !== '/config.json' && !isAppPath(rel))) return send(res, 404, 'Not found');
    if (!(await stat(file)).isFile()) return send(res, 404, 'Not found');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      // The service worker handles caching; keep the HTTP cache out of the way during development.
      'Cache-Control': 'no-cache',
      ...(file.endsWith('sw.js') ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`Plex Poster Display → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
});

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}

if (args.includes('--mock')) {
  const { startMockPlex } = await import('./mock-plex.mjs');
  const port = Number(opt('mock-port', 32401));
  await startMockPlex({ port, host: HOST });
  console.log(`Mock Plex server   → http://localhost:${port}  (token: demo-token, library key: 1)`);
}
