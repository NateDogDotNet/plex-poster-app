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

// ---- settings-and-schedule-core: new keys ----

import { NEVER_EXPORT_KEYS, EXPORT_VERSION } from '../js/settings.js';

const NEW_DEFAULTS = {
  rotateUi: true, statusIndicator: 'dot', posterCacheLimit: 100, maxContentRating: '', limitNowPlaying: true,
  sleepEnabled: false, sleepStart: '01:00', sleepEnd: '07:00', idleSleepHours: 0, wakeOnPlayback: true,
  pixelShift: true, pixelShiftMinutes: 3, frameBrightness: 100, nightDim: false, nightDimStart: '22:00',
  nightDimEnd: '07:00', nightDimLevel: 60, nightDimTarget: 'frame', dailyReload: true, dailyReloadTime: '04:00',
  kioskMode: false, disableShortcuts: false, settingsPinHash: '', settingsPinSalt: '', deviceHelper: false,
  controlLabels: 'auto', showMeta: false, showProgress: true, showPlayer: false, fillMode: 'none',
};

test('defaults table for the new keys', () => {
  const d = defaults();
  for (const [k, v] of Object.entries(NEW_DEFAULTS)) assert.deepEqual(d[k], v, k);
});

test('deferred keys do not exist', () => {
  const d = defaults();
  for (const k of ['bulbAnimation', 'frameRotation', 'frameRotationIds', 'frameIdRandom', 'fillCount']) assert.equal(k in d, false, k);
  assert.equal(sanitize({ fillMode: 'multi' }).fillMode, 'none');
});

test('hhmm sanitiser accepts HH:MM and falls back otherwise', () => {
  assert.equal(sanitize({ sleepStart: '00:00' }).sleepStart, '00:00');
  assert.equal(sanitize({ sleepStart: '23:59' }).sleepStart, '23:59');
  for (const bad of ['24:00', '12:60', '7:00', '0700', 'ab:cd', '', 5, true, '12:00:00', ' 1:00']) {
    assert.equal(sanitize({ sleepStart: bad }).sleepStart, '01:00', String(bad));
    assert.equal(sanitize({ nightDimEnd: bad }).nightDimEnd, '07:00', String(bad));
    assert.equal(sanitize({ dailyReloadTime: bad }).dailyReloadTime, '04:00', String(bad));
  }
});

test('numeric ranges clamp finite numbers; junk falls back to the default; counts round', () => {
  assert.equal(sanitize({ posterCacheLimit: 1 }).posterCacheLimit, 10);
  assert.equal(sanitize({ posterCacheLimit: 9999 }).posterCacheLimit, 300);
  assert.equal(sanitize({ idleSleepHours: 99 }).idleSleepHours, 48);
  assert.equal(sanitize({ idleSleepHours: -1 }).idleSleepHours, 0);
  assert.equal(sanitize({ pixelShiftMinutes: 0 }).pixelShiftMinutes, 1);
  assert.equal(sanitize({ pixelShiftMinutes: 500 }).pixelShiftMinutes, 60);
  assert.equal(sanitize({ frameBrightness: 0 }).frameBrightness, 10);
  assert.equal(sanitize({ nightDimLevel: 1000 }).nightDimLevel, 100);
  assert.equal(sanitize({ nightDimLevel: 'x' }).nightDimLevel, 60);
  // numeric strings (form fields) are accepted
  assert.equal(sanitize({ posterCacheLimit: '50' }).posterCacheLimit, 50);
  // junk -> default, not the minimum
  for (const junk of ['', '  ', true, false, [], [5], {}, 'abc', NaN, Infinity, -Infinity]) {
    const s = sanitize({ posterCacheLimit: junk, idleSleepHours: junk, pixelShiftMinutes: junk, frameBrightness: junk, nightDimLevel: junk });
    assert.equal(s.posterCacheLimit, 100, `posterCacheLimit ${String(junk)}`);
    assert.equal(s.idleSleepHours, 0, `idleSleepHours ${String(junk)}`);
    assert.equal(s.pixelShiftMinutes, 3, `pixelShiftMinutes ${String(junk)}`);
    assert.equal(s.frameBrightness, 100, `frameBrightness ${String(junk)}`);
    assert.equal(s.nightDimLevel, 60, `nightDimLevel ${String(junk)}`);
  }
  // count keys round to integers
  assert.equal(sanitize({ posterCacheLimit: 10.5 }).posterCacheLimit, 11);
  assert.equal(sanitize({ posterCacheLimit: '99.4' }).posterCacheLimit, 99);
  assert.equal(sanitize({ idleSleepHours: 2.6 }).idleSleepHours, 3);
  assert.equal(sanitize({ pixelShiftMinutes: 2.2 }).pixelShiftMinutes, 2);
  // existing 2.0 keys keep their clamping behaviour
  assert.equal(sanitize({ rotateSeconds: 1 }).rotateSeconds, 10);
});

test('enumerations fall back to the default', () => {
  assert.equal(sanitize({ statusIndicator: 'text' }).statusIndicator, 'dot');
  assert.equal(sanitize({ statusIndicator: 'off' }).statusIndicator, 'off');
  for (const r of ['', 'G', 'PG', 'PG-13', 'R', 'NC-17']) assert.equal(sanitize({ maxContentRating: r }).maxContentRating, r);
  // K21 (D31): an unknown limit fails closed to PG-13, never to "no limit"; absent or null still means no limit.
  for (const junk of ['X', 'PG13', 'pg13', 'pg-13', 'R18', ' R ', 'NC17', 5, true, {}, []]) {
    assert.equal(sanitize({ maxContentRating: junk }).maxContentRating, 'PG-13', `maxContentRating ${JSON.stringify(junk)}`);
  }
  assert.equal(sanitize({}).maxContentRating, '');
  assert.equal(sanitize({ maxContentRating: null }).maxContentRating, '');
  assert.equal(sanitize({ maxContentRating: undefined }).maxContentRating, '');
  assert.equal(defaults().maxContentRating, '');
  assert.equal(sanitize({ nightDimTarget: 'stage' }).nightDimTarget, 'stage');
  assert.equal(sanitize({ nightDimTarget: 'x' }).nightDimTarget, 'frame');
  for (const c of ['auto', 'always', 'never']) assert.equal(sanitize({ controlLabels: c }).controlLabels, c);
  assert.equal(sanitize({ controlLabels: 'x' }).controlLabels, 'auto');
  for (const f of ['none', 'blur', 'info']) assert.equal(sanitize({ fillMode: f }).fillMode, f);
});

test('PIN material sanitiser accepts hex only', () => {
  assert.equal(sanitize({ settingsPinHash: 'ab12' }).settingsPinHash, 'ab12');
  assert.equal(sanitize({ settingsPinHash: 'zz' }).settingsPinHash, '');
  assert.equal(sanitize({ settingsPinSalt: 5 }).settingsPinSalt, '');
});

test('NEVER_EXPORT_KEYS is exactly the two PIN keys and export drops them', () => {
  assert.deepEqual(NEVER_EXPORT_KEYS, ['settingsPinHash', 'settingsPinSalt']);
  const s = { ...defaults(), plexToken: 't', settingsPinHash: 'a'.repeat(64), settingsPinSalt: 'bb' };
  for (const opts of [undefined, { includeSecrets: true }]) {
    const o = toExport(s, opts).settings;
    for (const k of NEVER_EXPORT_KEYS) assert.equal(k in o, false, k);
  }
  assert.equal(toExport(s, { includeSecrets: true }).settings.plexToken, 't');
  assert.equal(EXPORT_VERSION, 1);
});

test('import cannot plant or clear a PIN', () => {
  const file = JSON.stringify({ format: 'plex-poster-display/settings', version: 1, settings: { settingsPinHash: 'a'.repeat(64), settingsPinSalt: 'b', rotateSeconds: 60 } });
  const s = fromImport(file);
  assert.equal(s.settingsPinHash, '');
  assert.equal(s.settingsPinSalt, '');
  assert.equal(s.rotateSeconds, 60);
  assert.equal(s.pixelShift, true);
  const kept = fromImport(file, { ...defaults(), settingsPinHash: 'cc', settingsPinSalt: 'dd' });
  assert.equal(kept.settingsPinHash, 'cc');
  assert.equal(kept.settingsPinSalt, 'dd');
  // only PIN keys in the file: nothing recognised
  assert.throws(() => fromImport({ settingsPinHash: 'aa' }), /No recognised settings/);
});

test('a 2.0.0 export imports with the new keys at their defaults', () => {
  const old = { format: 'plex-poster-display/settings', version: 1, settings: { rotateSeconds: 90, rotation: 180 } };
  const s = fromImport(JSON.stringify(old));
  assert.equal(s.rotation, 180);
  for (const [k, v] of Object.entries(NEW_DEFAULTS)) assert.deepEqual(s[k], v, k);
});

test('stored 2.0.0 settings load with new keys filled', () => {
  const { settings } = load(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ rotateSeconds: 60 }) }));
  assert.equal(settings.rotateSeconds, 60);
  assert.equal(settings.pixelShift, true);
});
