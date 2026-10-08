#!/usr/bin/env node
// Zero-dependency static server for the app (localhost counts as a secure context,
// so the service worker and install prompt work without https).
//
//   node scripts/serve.mjs                 # http://localhost:8080
//   node scripts/serve.mjs --port 3000
//   node scripts/serve.mjs --host 0.0.0.0  # reachable from other devices on the LAN
//   node scripts/serve.mjs --mock          # plus a fake Plex server on :32401 for demos/tests

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
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
// Never serve repo internals.
const BLOCKED = /^\/(\.git|node_modules|tests|scripts|design)(\/|$)/;

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (BLOCKED.test(path)) return send(res, 404, 'Not found');
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
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
