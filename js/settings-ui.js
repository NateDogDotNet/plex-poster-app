// Settings sheet: form binding, live layout preview, Plex sign-in and import/export.

import { FRAMES, NO_FRAME, CUSTOM_FRAME_ID } from './frames.js';
import { createPin, checkPin, createPlexClient, discoverServers, firstReachable } from './plex.js';
import { defaults, fromImport, sanitize, toExport } from './settings.js';
import { downloadJson, toast } from './util.js';

const LAYOUT_KEYS = ['posterScale', 'posterOffsetX', 'posterOffsetY'];

export function createSettingsUI({ getSettings, clientId, log, onPreview, onSave, onClearCache, onReset }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('settings');
  const form = $('settings-form');
  const field = (name) => form.elements.namedItem(name);
  let original = null;
  let pinAbort = null;
  let servers = [];
  // The pin the dialog would save: set by write() (open and import), cleared by Unpin, used by read(). It is separate
  // from the saved pin, which the live preview keeps applying until Save (an unsaved pin is never drawn, D29).
  let pendingPin = { key: '', title: '' };

  // Frame options are built from the registry so new frames only need adding there.
  $('frame-select').replaceChildren(
    ...[...FRAMES, NO_FRAME, { id: CUSTOM_FRAME_ID, name: 'Custom image…' }].map((f) => new Option(f.name, f.id)),
  );

  function write(s) {
    for (const el of form.elements) {
      if (!el.name || !(el.name in s)) continue;
      if (el.type === 'checkbox') el.checked = Boolean(s[el.name]);
      else el.value = String(s[el.name]);
    }
    // The household toggle is UI-only: on when a limit is set; off stores ''. The select keeps PG-13 while off.
    $('household-toggle').checked = Boolean(s.maxContentRating);
    field('maxContentRating').value = s.maxContentRating || 'PG-13';
    ensureLibraryOption(s.libraryKey, s.libraryName);
    field('libraryKey').value = s.libraryKey;
    pendingPin = { key: s.staticRatingKey || '', title: s.staticTitle || '' };
    $('pinned-title').textContent = s.staticRatingKey ? s.staticTitle || `item ${s.staticRatingKey}` : 'none';
    $('unpin-btn').hidden = !s.staticRatingKey;
    syncDependent();
  }

  function read() {
    const s = { ...getSettings() };
    for (const el of form.elements) {
      if (!el.name || !(el.name in s)) continue;
      s[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    s.maxContentRating = $('household-toggle').checked ? field('maxContentRating').value : '';
    const lib = field('libraryKey');
    s.libraryName = lib.selectedOptions[0]?.dataset.title || s.libraryName;
    s.staticRatingKey = pendingPin.key;
    s.staticTitle = pendingPin.title;
    return sanitize(s);
  }

  function syncDependent() {
    $('custom-frame-row').hidden = field('frameId').value !== CUSTOM_FRAME_ID;
    $('household-options').hidden = !$('household-toggle').checked;
    field('username').disabled = !field('showNowPlaying').checked;
    field('includeEpisodes').disabled = !field('showNowPlaying').checked;
    for (const out of form.querySelectorAll('output[data-for]')) {
      const v = Number(field(out.dataset.for).value);
      out.textContent = out.dataset.for === 'posterScale' ? `${v}%` : `${v > 0 ? '+' : ''}${v}%`;
    }
  }

  function ensureLibraryOption(key, title) {
    const select = field('libraryKey');
    if (!key || [...select.options].some((o) => o.value === key)) return;
    const o = new Option(title || `Library ${key}`, key);
    o.dataset.title = title || '';
    select.append(o);
  }

  function fillLibraries(libs, selected) {
    const select = field('libraryKey');
    const usable = libs.filter((l) => l.type === 'movie' || l.type === 'show');
    select.replaceChildren(new Option('— choose a library —', ''));
    for (const l of usable) {
      const o = new Option(`${l.title} (${l.type === 'movie' ? 'movies' : 'TV'})`, l.key);
      o.dataset.title = l.title;
      select.append(o);
    }
    const movie = usable.find((l) => l.type === 'movie');
    select.value = usable.some((l) => l.key === selected) ? selected : movie?.key || '';
  }

  async function testConnection() {
    const s = read();
    const out = $('test-result');
    if (!s.serverUrl || !s.plexToken) {
      out.textContent = 'Enter a token and server URL first (or sign in).';
      return false;
    }
    if (location.protocol === 'https:' && s.serverUrl.startsWith('http:')) {
      out.textContent = 'This page is https, so the browser will block an http:// server. Use the plex.direct https address (Sign in finds it) or serve the app over http on your LAN.';
      return false;
    }
    out.textContent = 'Connecting…';
    $('test-btn').disabled = true;
    try {
      const client = createPlexClient({ serverUrl: s.serverUrl, token: s.plexToken, clientId });
      const id = await client.identity();
      const libs = await client.libraries();
      fillLibraries(libs, s.libraryKey);
      out.textContent = `✓ ${id.name || 'Server'}${id.version ? ` (v${id.version.split('-')[0]})` : ''} — ${libs.length} libraries`;
      form.dataset.serverName = id.name;
      log.info(`Connection test OK: ${id.name}`);
      return true;
    } catch (err) {
      out.textContent = `✗ ${err.message}`;
      log.warn(`Connection test failed: ${err.message}`);
      return false;
    } finally {
      $('test-btn').disabled = false;
    }
  }

  // ---- Sign in with Plex (plex.tv/link PIN) ----

  async function signIn() {
    cancelSignIn();
    const ctrl = new AbortController();
    pinAbort = ctrl;
    $('signin-panel').hidden = false;
    $('signin-btn').disabled = true;
    $('signin-status').textContent = 'Requesting a code…';
    try {
      const pin = await createPin(clientId);
      $('signin-code').textContent = pin.code;
      $('signin-status').textContent = 'Waiting for you to approve…';
      const expires = pin.expiresAt ? Date.parse(pin.expiresAt) : Date.now() + 15 * 60 * 1000;
      let token = null;
      while (!ctrl.signal.aborted && Date.now() < expires) {
        await new Promise((r) => setTimeout(r, 2000));
        if (ctrl.signal.aborted) return;
        token = await checkPin(clientId, pin.id).catch(() => null);
        if (token) break;
      }
      if (!token) {
        if (!ctrl.signal.aborted) $('signin-status').textContent = 'Code expired — try again.';
        return;
      }
      $('signin-status').textContent = 'Signed in. Finding your servers…';
      field('plexToken').value = token;
      servers = await discoverServers(clientId, token, { secureOnly: location.protocol === 'https:' });
      if (!servers.length) {
        $('signin-status').textContent = 'Signed in, but no reachable servers were found on this account.';
        return;
      }
      const select = $('server-select');
      select.replaceChildren(...servers.map((sv, i) => new Option(`${sv.name}${sv.owned ? '' : ' (shared)'}`, String(i))));
      $('server-pick').hidden = servers.length < 2;
      await useServer(0);
      $('signin-panel').hidden = true;
      log.info('Signed in with Plex');
    } catch (err) {
      $('signin-status').textContent = `Sign-in failed: ${err.message}`;
      log.warn(`Sign-in failed: ${err.message}`);
    } finally {
      $('signin-btn').disabled = false;
      if (pinAbort === ctrl) pinAbort = null;
    }
  }

  async function useServer(index) {
    const sv = servers[index];
    if (!sv) return;
    $('test-result').textContent = `Finding a working address for ${sv.name}…`;
    const uri = await firstReachable(sv.connections, sv.accessToken, clientId);
    if (!uri) {
      $('test-result').textContent = `✗ Couldn't reach ${sv.name} from this device.`;
      return;
    }
    field('plexToken').value = sv.accessToken;
    field('serverUrl').value = uri;
    form.dataset.serverName = sv.name;
    await testConnection();
  }

  function cancelSignIn() {
    pinAbort?.abort();
    pinAbort = null;
    $('signin-panel').hidden = true;
    $('signin-btn').disabled = false;
  }

  // ---- events ----

  form.addEventListener('input', (e) => {
    syncDependent();
    if (e.target.closest('[data-live]')) onPreview(read());
  });
  form.addEventListener('change', (e) => {
    syncDependent();
    if (e.target.closest('[data-live]')) onPreview(read());
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = read();
    s.serverName = form.dataset.serverName || s.serverName;
    const err = $('form-error');
    if (s.plexToken && s.serverUrl && !s.libraryKey && !s.staticRatingKey) {
      err.textContent = 'Choose a library (test the connection to load them).';
      return;
    }
    err.textContent = '';
    original = null;
    cancelSignIn();
    dialog.close();
    onSave(s);
  });

  $('settings-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    cancelSignIn();
    if (original) onPreview(original); // undo live preview
    original = null;
  });

  $('signin-btn').addEventListener('click', signIn);
  $('signin-cancel').addEventListener('click', cancelSignIn);
  $('server-select').addEventListener('change', (e) => useServer(Number(e.target.value)));
  $('test-btn').addEventListener('click', testConnection);
  $('token-toggle').addEventListener('click', (e) => {
    const t = field('plexToken');
    t.type = t.type === 'password' ? 'text' : 'password';
    e.target.textContent = t.type === 'password' ? 'Show' : 'Hide';
  });

  $('reset-layout').addEventListener('click', () => {
    const d = defaults();
    for (const k of LAYOUT_KEYS) field(k).value = d[k];
    syncDependent();
    onPreview(read());
  });

  $('unpin-btn').addEventListener('click', (e) => {
    pendingPin = { key: '', title: '' };
    e.target.hidden = true;
    $('pinned-title').textContent = 'none (unpinned on save)';
  });

  $('export-btn').addEventListener('click', () => {
    const includeSecrets = $('export-secrets').checked;
    downloadJson('plex-poster-settings.json', toExport(read(), { includeSecrets }));
    if (includeSecrets) toast('Exported with your Plex token — keep that file private.');
  });

  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const s = fromImport(await file.text(), read());
      write(s);
      onPreview(s);
      toast('Settings imported — review and press Save.');
      log.info(`Imported settings from ${file.name}`);
    } catch (err) {
      $('form-error').textContent = `Import failed: ${err.message}`;
    }
  });

  $('clear-cache-btn').addEventListener('click', async () => {
    await onClearCache();
    toast('Poster cache cleared.');
  });

  $('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset all settings, including your Plex token, and clear cached posters?')) return;
    original = null;
    dialog.close();
    onReset();
  });

  return {
    open({ firstRun = false } = {}) {
      if (dialog.open) return;
      original = getSettings();
      $('form-error').textContent = '';
      $('test-result').textContent = '';
      $('first-run-hint').hidden = !firstRun;
      form.dataset.serverName = original.serverName;
      write(original);
      $('manual-connection').open = Boolean(original.plexToken && !original.serverName);
      dialog.showModal();
      if (original.plexToken && original.serverUrl) testConnection();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
