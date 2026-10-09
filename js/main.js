// App bootstrap: wires settings, Plex, the poster engine, display and controls together.

import { createBackoff } from './backoff.js';
import { createDisplay } from './display.js';
import { createEngine } from './engine.js';
import { createPlexClient } from './plex.js';
import { createPosterCache } from './poster-cache.js';
import { requestSize } from './layout.js';
import { isPlausibleClock } from './schedule.js';
import { createSettingsUI } from './settings-ui.js';
import { fromImport, isConfigured, load, save, STORAGE_KEY } from './settings.js';
import { decideSleep, MANUAL_WAKE_MS } from './sleep.js';
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
  asleep: false,
  sleepWhy: '', // 'schedule' | 'idle' | 'manual wake' | ''
  playing: false, // the last poll saw a matching session (only polled while sleep needs it)
  lastPlaybackAt: Date.now(),
  manualWakeUntil: 0,
  swallowUntil: 0, // performance.now() until which clicks are swallowed (after a press that only woke the display)
  pollFailing: false,
  pollFailures: 0, // consecutive failed playback polls
  sleepClock: { wall: Date.now(), mono: performance.now() },
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
  return s.showNowPlaying || playbackMatters(s) ? Math.min(rotate, s.nowPlayingPollSeconds * 1000) : rotate;
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
    const sessions = await pollPlayback(); // fetched once; decide() reuses it
    // Asleep: Plex is polled above, but no poster is chosen, fetched or shown.
    const decision = state.asleep ? null : await engine.decide({ force, sessions });
    if (decision) {
      let image = await fetchImage(decision.poster);
      if (!state.asleep) {
        // (Asleep by now: the download began before sleep did; it is not drawn under the veil.)
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
  if (due && !fatal && !state.asleep) {
    const cached = await cache.random(current?.ratingKey).catch(() => null);
    if (cached) {
      await display.show(cached.poster, cached.blob).catch(() => {});
      engine?.shown(cached.poster);
      state.lastReason = 'offline – cached';
    }
  }
  if (!display.currentPoster) showEmpty(true, err.message);
  // Asleep, the only thing to retry is the playback poll: keep it at its normal rate, not the 5 minute backoff.
  const retryMs = fatal ? 5 * 60 * 1000 : backoff.next();
  schedule(state.asleep ? Math.min(retryMs, state.settings.nowPlayingPollSeconds * 1000) : retryMs);
}

// ---------- Sleep ----------

const MAX_POLL_FAILURES = 3;
// Playback can change the sleep decision only if it wakes a schedule sleep or restarts the idle clock.
const playbackMatters = (s) => (s.sleepEnabled && s.wakeOnPlayback) || s.idleSleepHours > 0;

/**
 * Asks Plex whether anything is playing, when sleep needs to know, and returns the sessions it saw
 * (undefined when it did not ask or could not). May wake the display. A failed poll never refreshes
 * `lastPlaybackAt` and keeps the last `playing` for at most MAX_POLL_FAILURES failures in a row (a blip
 * must not black a movie out; an outage must not hold the display awake all night). Awake, the failure is
 * only logged and rotation carries on (a shared or managed token is often refused /status/sessions);
 * asleep, it goes to handleFailure, which retries at the poll rate.
 */
async function pollPlayback() {
  if (!playbackMatters(state.settings)) {
    state.playing = false;
    state.pollFailures = 0;
    return undefined;
  }
  let sessions;
  try {
    sessions = await client.sessions();
  } catch (err) {
    if (++state.pollFailures >= MAX_POLL_FAILURES) state.playing = false; // the 1 s evaluateSleep() timer acts on it
    if (state.asleep) throw err;
    if (!state.pollFailing) log.warn(`Playback check failed: ${err.message}`);
    state.pollFailing = true;
    return undefined;
  }
  state.pollFailing = false;
  state.pollFailures = 0;
  state.playing = Boolean(await engine.playing(sessions));
  if (state.playing) {
    syncSleepClock();
    state.lastPlaybackAt = Date.now();
  }
  evaluateSleep();
  return sessions;
}

/**
 * A clock step (NTP arriving, a manual change) must not read as hours of idleness or a stuck manual wake:
 * compare the wall clock with the monotonic one and shift the stored timestamps by the gap. Call it before
 * every write of a wall-clock timestamp (so the step is absorbed first and the new stamp is not shifted
 * again) and at the top of evaluateSleep().
 */
function syncSleepClock() {
  const wall = Date.now();
  const mono = performance.now();
  const jump = wall - state.sleepClock.wall - (mono - state.sleepClock.mono);
  state.sleepClock = { wall, mono };
  if (Math.abs(jump) > 5000) {
    state.lastPlaybackAt += jump;
    if (state.manualWakeUntil) state.manualWakeUntil += jump;
  }
}

/** Applies decideSleep() to the page: the veil and body.asleep. The wake lock is never touched. */
function evaluateSleep() {
  syncSleepClock();
  const now = new Date();
  const { asleep, why } = decideSleep({
    now,
    settings: state.settings,
    lastPlaybackAt: state.lastPlaybackAt,
    playingNow: state.playing,
    manualWakeUntil: state.manualWakeUntil,
    clockOk: isPlausibleClock(now),
  });
  state.sleepWhy = why;
  if (asleep === state.asleep) return;
  state.asleep = asleep;
  $('sleep-veil').hidden = !asleep;
  $('app').inert = asleep; // top-layer dialogs are outside #app and stay usable
  document.body.classList.toggle('asleep', asleep);
  if (asleep) $('controls').classList.remove('visible');
  log.info(asleep ? `Asleep (${why})` : 'Awake');
  if (!state.busy && !state.paused) tick(); // asleep: look for playback now; awake: show a poster now
}
setInterval(evaluateSleep, 1000);

const SWALLOW_MS = 800;

/** Settings and Diagnostics sit above the veil; input aimed at them is never swallowed. */
const inOpenDialog = (e) => e.target instanceof Element && Boolean(e.target.closest('dialog[open]'));

/**
 * A touch, click or key press while asleep only wakes: it never reaches the control under the finger.
 * Clicks stay swallowed until SWALLOW_MS after the last press that began asleep or inside that window, so a
 * second blind tap does not land on the controls the first one uncovered. During a manual wake any press or
 * key restarts the minute, in dialogs too.
 */
function manualWake(e) {
  const swallowing = e.type === 'pointerdown' && performance.now() < state.swallowUntil;
  if (!state.asleep && !swallowing && state.sleepWhy !== 'manual wake') return;
  syncSleepClock();
  state.manualWakeUntil = Date.now() + MANUAL_WAKE_MS;
  if ((state.asleep || swallowing) && !inOpenDialog(e)) {
    e.stopPropagation();
    e.preventDefault();
    if (e.type === 'pointerdown') state.swallowUntil = performance.now() + SWALLOW_MS;
  }
  evaluateSleep();
}
window.addEventListener('pointerdown', manualWake, true);
window.addEventListener('keydown', manualWake, true);
window.addEventListener(
  'pointermove',
  () => {
    if (state.sleepWhy !== 'manual wake') return;
    syncSleepClock();
    state.manualWakeUntil = Date.now() + MANUAL_WAKE_MS;
  },
  { capture: true, passive: true },
);
window.addEventListener(
  'click',
  (e) => {
    if (performance.now() >= state.swallowUntil || inOpenDialog(e)) return;
    e.stopPropagation();
    e.preventDefault();
  },
  true,
);

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
  syncSleepClock();
  state.lastPlaybackAt = Date.now(); // a save counts as a fresh start for the idle clock
  evaluateSleep();

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
    Sleep: `${state.asleep ? 'asleep' : 'awake'}${state.sleepWhy ? ` (${state.sleepWhy})` : ''}`,
    'Local time': `${new Date().toLocaleString()}${isPlausibleClock(new Date()) ? '' : ' — Clock not set'}`,
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
  evaluateSleep(); // black before the first poster, not after
  if (!storage.persistent) log.warn('localStorage unavailable — settings will not survive a reload.');

  registerServiceWorker();
  await applySettings(state.settings, { persist: false });
  if (!isConfigured(state.settings)) settingsUI.open({ firstRun: true });
  wake();
}

boot();
