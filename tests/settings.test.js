import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, fromImport, isConfigured, load, sanitize, save, STORAGE_KEY, toExport } from '../js/settings.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
  };
}

test('sanitize fills defaults, clamps numbers and drops unknown keys', () => {
  const s = sanitize({ rotateSeconds: 1, posterScale: 'abc', rotation: 45, serverUrl: 'http://x:32400///', bogus: 1 });
  assert.equal(s.rotateSeconds, 10);
  assert.equal(s.posterScale, defaults().posterScale);
  assert.equal(s.rotation, 0);
  assert.equal(s.serverUrl, 'http://x:32400');
  assert.equal('bogus' in s, false);
});

test('booleans accept string forms', () => {
  assert.equal(sanitize({ showNowPlaying: 'false' }).showNowPlaying, false);
  assert.equal(sanitize({ showNowPlaying: 'nope' }).showNowPlaying, true);
});

test('isConfigured needs token, server and a library or pinned item', () => {
  assert.equal(isConfigured(defaults()), false);
  assert.equal(isConfigured({ ...defaults(), plexToken: 't', serverUrl: 'http://s', libraryKey: '1' }), true);
  assert.equal(isConfigured({ ...defaults(), plexToken: 't', serverUrl: 'http://s', staticRatingKey: '9' }), true);
});

test('load migrates the original per-key localStorage format', () => {
  const storage = memoryStorage({
    PLEX_TOKEN: 'tok',
    PLEX_SERVER_URL: 'http://192.168.1.2:32400',
    PLEX_USERNAME: 'nate',
    LIBRARY_KEY: '1',
    REFRESH_INTERVAL_MS: '120000',
    POSTER_SCALE: '90',
  });
  const { settings, source } = load(storage);
  assert.equal(source, 'legacy');
  assert.equal(settings.plexToken, 'tok');
  assert.equal(settings.username, 'nate');
  assert.equal(settings.rotateSeconds, 120);
  assert.equal(settings.posterScale, 100);
  assert.deepEqual(storage.keys(), [STORAGE_KEY]);
});

test('load survives corrupt JSON', () => {
  const { settings, source } = load(memoryStorage({ [STORAGE_KEY]: '{oops' }));
  assert.equal(source, 'defaults');
  assert.deepEqual(settings, defaults());
});

test('save + load round-trips', () => {
  const storage = memoryStorage();
  save(storage, { ...defaults(), plexToken: 'abc', rotation: 90 });
  const { settings } = load(storage);
  assert.equal(settings.plexToken, 'abc');
  assert.equal(settings.rotation, 90);
});

test('export omits the token unless asked', () => {
  const s = { ...defaults(), plexToken: 'secret' };
  assert.equal('plexToken' in toExport(s).settings, false);
  assert.equal(toExport(s, { includeSecrets: true }).settings.plexToken, 'secret');
});

test('import merges over current settings and keeps the existing token', () => {
  const current = { ...defaults(), plexToken: 'keep' };
  const file = JSON.stringify(toExport({ ...defaults(), rotation: 180, rotateSeconds: 60 }));
  const s = fromImport(file, current);
  assert.equal(s.plexToken, 'keep');
  assert.equal(s.rotation, 180);
  assert.equal(s.rotateSeconds, 60);
});

test('import accepts a bare object and the old CONFIG shape', () => {
  const s = fromImport({ PLEX_TOKEN: 't', PLEX_SERVER_URL: 'http://s:32400', LIBRARY_KEY: '3', REFRESH_INTERVAL_MS: 300000 });
  assert.equal(s.plexToken, 't');
  assert.equal(s.libraryKey, '3');
  assert.equal(s.rotateSeconds, 300);
});

test('import rejects bad files with a readable message', () => {
  assert.throws(() => fromImport('not json'), /not valid JSON/);
  assert.throws(() => fromImport('[]'), /JSON object/);
  assert.throws(() => fromImport('{"format":"other"}'), /Unknown file format/);
  assert.throws(() => fromImport('{"hello":1}'), /No recognised settings/);
  assert.throws(() => fromImport(JSON.stringify({ format: 'plex-poster-display/settings', version: 99, settings: {} })), /newer version/);
});
