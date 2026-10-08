// Service worker: precaches the app shell so the display starts with no network.
// Plex traffic is never intercepted — posters are cached by the page itself (poster-cache.js).
//
// Bump VERSION whenever any file in SHELL changes so clients pick up the update.
const VERSION = '2.0.0';
const SHELL_CACHE = `shell-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/backoff.js',
  'js/display.js',
  'js/engine.js',
  'js/frames.js',
  'js/layout.js',
  'js/plex.js',
  'js/poster-cache.js',
  'js/schedule.js',
  'js/settings.js',
  'js/settings-ui.js',
  'js/util.js',
  'assets/frames/marquee.png',
  'assets/frames/marquee-narrow.png',
  'assets/frames/marquee-glow.png',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Plex server, plex.tv: straight to network
  if (url.pathname.endsWith('/config.json')) return; // provisioning file: always fresh

  // Navigations: network first so a redeploy shows up, falling back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Everything else from our origin: cache first, then network (and cache custom frames etc.).
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
