// App bootstrap: wires settings, Plex, the poster engine, display and controls together.

import { createBackoff } from './backoff.js';
import { createDisplay } from './display.js';
import { createEngine } from './engine.js';
import { createPlexClient } from './plex.js';
import { createPosterCache } from './poster-cache.js';
import { requestSize } from './layout.js';
import { createSettingsUI } from './settings-ui.js';
import { fromImport, isConfigured, load, save, STORAGE_KEY } from './settings.js';
import { clientId as getClientId, createLog, formatDuration, safeStorage, toast } from './util.js';

export const VERSION = '2.0.0';

const storage = safeStorage();
const log = createLog();
const cache = createPosterCache({ storage, limit: () => state.settings.posterCacheLimit });
const display = createDisplay();
const clientIdValue = getClientId(storage);
const $ = (id) => document.getElementById(id);

const state = {
  settings: load(storage).settings,
  paused: false,
  timer: 0,
  nextAt: 0,
  offlineSince: 0,
  lastSuccessAt: 0,
  lastError: '',
  lastReason: '',
  directImages: false, // set when the server doesn't allow fetching images (CORS)
  wakeLock: null,
  busy: false,
};

let client = null;
let engine = null;
const backoff = createBackoff({ baseMs: 5000, maxMs: 5 * 60 * 1000 });

function rebuildClient() {
  const s = state.settings;
  client = isConfigured(s) ? createPlexClient({ serverUrl: s.serverUrl, token: s.plexToken, clientId: clientIdValue }) : null;
  engine = client ? createEngine({ client, getSettings: () => state.settings }) : null;
  state.directImages = false;
}

// ---------- Poster cycle ----------

function intervalMs() {
  const s = state.settings;
  const rotate = s.rotateSeconds * 1000;
  return s.showNowPlaying ? Math.min(rotate, s.nowPlayingPollSeconds * 1000) : rotate;
}

function schedule(ms) {
  clearTimeout(state.timer);
  state.nextAt = 0;
  if (state.paused || !engine) return;
  state.nextAt = Date.now() + ms;
  state.timer = setTimeout(() => tick(), ms);
}

const cachedBlobs = new WeakSet(); // blobs served from the poster cache (not freshly downloaded)

async function fetchImage(poster, { skipCache = false } = {}) {
  const size = requestSize(display.posterSize(), window.devicePixelRatio || 1);
  const url = client.imageUrl(poster.thumb, size);
  if (state.directImages) return url;
  const hit = skipCache ? null : await cache.lookup(poster, size).catch(() => null);
  if (hit) {
    cachedBlobs.add(hit);
    return hit;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout?.(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    cache.put(poster, blob, size).catch((err) => log.warn(`Could not cache poster: ${err.message}`));
    return blob;
  } catch (err) {
    // fetch() reports CORS blocks and a dead server the same way. If a plain <img> can
    // still load it, it's CORS: display directly from now on, without offline caching.
    if (err instanceof TypeError && (await imageLoads(url))) {
      state.directImages = true;
      log.warn('Server blocked image download; showing posters directly (offline cache disabled).');
      return url;
    }
    throw err;
  }
}

function imageLoads(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function tick({ force = false } = {}) {
  if (!engine || state.busy) return;
  state.busy = true;
  try {
    const decision = await engine.decide({ force });
    if (decision) {
      let image = await fetchImage(decision.poster);
      try {
        await display.show(decision.poster, image);
      } catch (err) {
        if (!cachedBlobs.has(image)) throw err;
        // The cached copy will not decode: drop it and download once (no retry loop).
        log.warn(`Cached poster "${decision.poster.title}" is unreadable; downloading it again.`);
        await cache.delete(decision.poster.ratingKey).catch(() => {});
        image = await fetchImage(decision.poster, { skipCache: true });
        await display.show(decision.poster, image);
      }
      engine.shown(decision.poster);
      state.lastReason = decision.reason;
      log.info(`Showing "${decision.poster.title}" (${decision.reason})`);
    }
    state.lastSuccessAt = Date.now();
    if (state.offlineSince) log.info(`Back online after ${formatDuration(Date.now() - state.offlineSince)}`);
    state.offlineSince = 0;
    state.lastError = '';
    backoff.reset();
    showEmpty(false);
    schedule(intervalMs());
  } catch (err) {
    await handleFailure(err);
  } finally {
    state.busy = false;
    updateStatus();
    updatePinButton();
  }
}

async function handleFailure(err) {
  state.lastError = err.message;
  if (!state.offlineSince) state.offlineSince = Date.now();
  const fatal = err.kind === 'auth' || err.kind === 'empty';
  log[fatal ? 'error' : 'warn'](err.message);

  // Keep the screen interesting while Plex is unavailable: rotate through cached posters.
  const current = engine?.current;
  const due = !current || Date.now() - (current.shownAt || 0) >= state.settings.rotateSeconds * 1000;
  if (due && !fatal) {
    const cached = await cache.random(current?.ratingKey).catch(() => null);
    if (cached) {
      await display.show(cached.poster, cached.blob).catch(() => {});
      engine?.shown(cached.poster);
      state.lastReason = 'offline – cached';
    }
  }
  if (!display.currentPoster) showEmpty(true, err.message);
  schedule(fatal ? 5 * 60 * 1000 : backoff.next());
}

// ---------- UI state ----------

function showEmpty(show, message) {
  $('empty').hidden = !show;
  if (message) $('empty-message').textContent = message;
}

function updateStatus() {
  const pill = $('status');
  let text = '';
  if (state.paused) text = 'Paused';
  if (state.offlineSince) {
    const retry = state.nextAt ? ` · retrying in ${formatDuration(state.nextAt - Date.now())}` : '';
    text = `${navigator.onLine === false ? 'Offline' : "Can't reach Plex"}${display.currentPoster ? ' · showing cached posters' : ''}${retry}`;
    if (state.paused) text = `Paused · ${text}`;
  }
  pill.hidden = !text;
  pill.textContent = text;
  pill.classList.toggle('warn', Boolean(state.offlineSince));
}
setInterval(updateStatus, 1000);

function updatePinButton() {
  const btn = document.querySelector('[data-action="pin"]');
  const pinned = Boolean(state.settings.staticRatingKey);
  btn.setAttribute('aria-pressed', String(pinned));
  btn.title = pinned ? `Unpin "${state.settings.staticTitle}"` : 'Pin this poster';
}

function setPaused(paused) {
  state.paused = paused;
  const btn = document.querySelector('[data-action="pause"]');
  btn.setAttribute('aria-pressed', String(paused));
  btn.setAttribute('aria-label', paused ? 'Resume auto-refresh' : 'Pause auto-refresh');
  btn.title = paused ? 'Resume auto-refresh (P)' : 'Pause auto-refresh (P)';
  btn.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  if (paused) {
    clearTimeout(state.timer);
    state.nextAt = 0;
    log.info('Auto-refresh paused');
  } else {
    log.info('Auto-refresh resumed');
    tick();
  }
  updateStatus();
}

// ---------- Settings ----------

async function applySettings(next, { persist = true, preview = false } = {}) {
  const prev = state.settings;
  state.settings = persist ? save(storage, next) : next;
  try {
    await display.apply(state.settings);
  } catch (err) {
    log.warn(err.message);
    if (!preview) toast(err.message);
  }
  if (preview) return;

  document.body.classList.toggle('hide-cursor', state.settings.hideCursor);
  updateWakeLock();
  updatePinButton();

  const connectionChanged = ['plexToken', 'serverUrl', 'libraryKey', 'unwatchedOnly', 'randomPoolSize'].some(
    (k) => prev[k] !== state.settings[k],
  );
  if (connectionChanged || !engine) rebuildClient();
  if (!isConfigured(state.settings)) {
    showEmpty(true, 'Connect to your Plex server to get started.');
    return;
  }
  tick({ force: connectionChanged });
}

const settingsUI = createSettingsUI({
  getSettings: () => state.settings,
  clientId: clientIdValue,
  log,
  onPreview: (s) => applySettings(s, { persist: false, preview: true }),
  onSave: (s) => {
    applySettings(s);
    toast('Settings saved.');
  },
  onClearCache: () => cache.clear(),
  onReset: async () => {
    storage.removeItem(STORAGE_KEY);
    await cache.clear();
    location.reload();
  },
});

function togglePin() {
  const s = state.settings;
  const current = engine?.current;
  if (s.staticRatingKey) {
    applySettings({ ...s, staticRatingKey: '', staticTitle: '' });
    toast('Unpinned — rotating posters again.');
  } else if (current) {
    applySettings({ ...s, staticRatingKey: current.ratingKey, staticTitle: current.title });
    toast(`Pinned "${current.title}".`);
  } else {
    toast('Nothing to pin yet.');
  }
}

function rotate() {
  applySettings({ ...state.settings, rotation: (state.settings.rotation + 90) % 360 });
}

// ---------- Diagnostics ----------

function renderDiagnostics() {
  const s = state.settings;
  const p = display.currentPoster;
  const rows = {
    Version: VERSION,
    'Service worker': navigator.serviceWorker?.controller ? 'active (works offline)' : 'not active',
    Installed: matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ? 'yes' : 'no (running in a tab)',
    Server: s.serverUrl ? `${s.serverName || ''} ${s.serverUrl}`.trim() : '—',
    Token: s.plexToken ? `${s.plexToken.slice(0, 4)}…` : '—',
    Library: s.libraryKey ? `${s.libraryName || ''} (key ${s.libraryKey})` : '—',
    'Now playing': s.showNowPlaying ? `on${s.username ? ` for ${s.username}` : ''}` : 'off',
    Poster: p ? `${p.title}${p.year ? ` (${p.year})` : ''} — ${p.source}` : '—',
    Reason: state.lastReason || '—',
    'Last success': state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleString() : 'never',
    'Next check': state.paused ? 'paused' : state.nextAt ? `in ${formatDuration(state.nextAt - Date.now())}` : '—',
    'Last error': state.lastError || 'none',
    'Cached posters': cache.available ? String(cache.entries().length) : 'unavailable',
    'Image mode': state.directImages ? 'direct (no offline cache)' : 'downloaded + cached',
    'Wake lock': state.wakeLock ? 'held' : s.keepAwake ? 'not held' : 'off',
    Storage: storage.persistent ? 'localStorage' : 'memory only (settings will not persist!)',
    Screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}x, rotation ${s.rotation}°`,
  };
  $('diag-list').replaceChildren(
    ...Object.entries(rows).flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  $('diag-log').replaceChildren(
    ...log.entries.map((e) => {
      const li = document.createElement('li');
      li.className = e.level;
      li.textContent = `${e.at.toLocaleTimeString()}  ${e.message}`;
      return li;
    }),
  );
}

function openDiagnostics() {
  renderDiagnostics();
  $('diagnostics').showModal();
}
log.onChange(() => $('diagnostics').open && renderDiagnostics());
$('diag-close').addEventListener('click', () => $('diagnostics').close());
$('diag-copy').addEventListener('click', async () => {
  const text = [
    ...[...$('diag-list').children].reduce((acc, el, i, arr) => (i % 2 ? acc : [...acc, `${el.textContent}: ${arr[i + 1].textContent}`]), []),
    '',
    ...log.entries.map((e) => `${e.at.toISOString()} [${e.level}] ${e.message}`),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Diagnostics copied.');
  } catch {
    toast('Clipboard not available.');
  }
});

// ---------- Controls, keyboard, idle ----------

const actions = {
  settings: () => settingsUI.open(),
  diagnostics: openDiagnostics,
  refresh: () => (engine ? tick({ force: true }) : settingsUI.open()),
  pause: () => setPaused(!state.paused),
  pin: togglePin,
  rotate,
  fullscreen: toggleFullscreen,
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn && actions[btn.dataset.action]) actions[btn.dataset.action]();
});

const KEYS = { s: 'settings', d: 'diagnostics', r: 'refresh', ' ': 'pause', p: 'pause', o: 'rotate', f: 'fullscreen' };
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
  const action = KEYS[e.key.toLowerCase()];
  if (action) {
    e.preventDefault();
    actions[action]();
  }
});

let idleTimer;
function wake() {
  $('controls').classList.add('visible');
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if ($('controls').matches(':hover, :focus-within')) return wake();
    $('controls').classList.remove('visible');
    document.body.classList.add('idle');
  }, 3500);
}
['pointermove', 'pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => toast('Full screen not allowed here.'));
}

// ---------- Screen wake lock ----------

async function updateWakeLock() {
  const want = state.settings.keepAwake && document.visibilityState === 'visible';
  if (!want) {
    await state.wakeLock?.release().catch(() => {});
    state.wakeLock = null;
    return;
  }
  if (state.wakeLock || !('wakeLock' in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => (state.wakeLock = null));
  } catch (err) {
    log.warn(`Wake lock unavailable: ${err.message}`);
  }
}

document.addEventListener('visibilitychange', () => {
  updateWakeLock();
  if (document.visibilityState === 'visible' && !state.paused && state.nextAt && Date.now() >= state.nextAt - 1000) tick();
});
window.addEventListener('online', () => {
  log.info('Network is back');
  if (!state.paused) tick();
});
window.addEventListener('offline', () => log.warn('Network went offline'));

let resizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => display.layout());
});

// ---------- Service worker (offline + installable) ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) {
    log.warn('Not a secure context (https or localhost): offline mode and install are unavailable.');
    return;
  }
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over. Kiosks are unattended, so reload into it automatically.
    if (hadController && !settingsUI.isOpen) location.reload();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      // Check for updates periodically; always-on displays rarely reload on their own.
      setInterval(() => reg.update().catch(() => {}), 6 * 60 * 60 * 1000);
    })
    .catch((err) => log.warn(`Service worker failed: ${err.message}`));
}

// ---------- Boot ----------

/** Optional provisioning: a config.json beside index.html seeds settings on first run. */
async function loadProvisionedConfig() {
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const s = fromImport(await res.text(), state.settings);
    log.info('Loaded settings from config.json');
    return s;
  } catch {
    return null;
  }
}

async function boot() {
  const { source } = load(storage);
  if (source === 'legacy') log.info('Migrated settings from the previous version (layout reset to defaults).');
  if (source === 'defaults') {
    const provisioned = await loadProvisionedConfig();
    if (provisioned) state.settings = save(storage, provisioned);
  }
  if (!storage.persistent) log.warn('localStorage unavailable — settings will not survive a reload.');

  registerServiceWorker();
  await applySettings(state.settings, { persist: false });
  if (!isConfigured(state.settings)) settingsUI.open({ firstRun: true });
  wake();
}

boot();
