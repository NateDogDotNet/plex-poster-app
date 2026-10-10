// Settings schema, persistence, legacy migration and import/export.
// Everything is stored as one JSON blob so it can be exported and validated as a unit.

export const STORAGE_KEY = 'plexPoster.settings';
export const EXPORT_FORMAT = 'plex-poster-display/settings';
export const EXPORT_VERSION = 1;

const num = (min, max) => (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
/** Strict numeric sanitiser for the keys added in 2.1: junk (non-numbers, booleans, arrays, blank strings) gives the default; finite numbers clamp; `int` rounds. */
const strictNum = (min, max, { int = false } = {}) => (v, d) => {
  if (typeof v !== 'number' && !(typeof v === 'string' && v.trim() !== '')) return d;
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, int ? Math.round(n) : n));
};
const bool = (v, d) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d);
const str = (v, d) => (typeof v === 'string' ? v.trim() : d);
const oneOf = (...allowed) => (v, d) => (allowed.includes(v) ? v : d);
const hhmm = (v, d) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
const hex = (v, d) => (typeof v === 'string' && /^[0-9a-f]*$/i.test(v) ? v : d);
const rotation = (v, d) => {
  const n = Number(v);
  return [0, 90, 180, 270].includes(n) ? n : d;
};

/** Each entry: [default, sanitiser]. Sanitisers coerce bad input back to the default. */
const SCHEMA = {
  // Connection
  plexToken: ['', str],
  serverUrl: ['', (v, d) => str(v, d).replace(/\/+$/, '')],
  serverName: ['', str],
  libraryKey: ['', (v, d) => str(String(v ?? ''), d)],
  libraryName: ['', str],
  username: ['', str],

  // What to show
  showNowPlaying: [true, bool],
  includeEpisodes: [true, bool],
  unwatchedOnly: [true, bool],
  randomPoolSize: [100, num(1, 1000)],
  staticRatingKey: ['', (v, d) => str(String(v ?? ''), d)],
  staticTitle: ['', str],

  // Timing (seconds)
  rotateSeconds: [300, num(10, 86400)],
  nowPlayingPollSeconds: [20, num(5, 3600)],

  // Display
  frameId: ['marquee', str],
  customFrameUrl: ['', str],
  posterFit: ['cover', oneOf('cover', 'contain', 'fill')],
  posterScale: [100, num(10, 300)],
  posterOffsetX: [0, num(-100, 100)],
  posterOffsetY: [0, num(-100, 100)],
  rotation: [0, rotation],
  crossfadeMs: [1200, num(0, 10000)],
  showTitle: [false, bool],

  // Device
  keepAwake: [true, bool],
  hideCursor: [true, bool],

  // Display, orientation and status
  rotateUi: [true, bool],
  statusIndicator: ['dot', oneOf('dot', 'off')],
  controlLabels: ['auto', oneOf('auto', 'always', 'never')],
  fillMode: ['none', oneOf('none', 'blur', 'info')],

  // Cache
  posterCacheLimit: [100, strictNum(10, 300, { int: true })],

  // Content filter
  // An unknown limit (a typo, a hand-edited file) fails closed to PG-13, never to "no limit" (K21, D31). Absent stays ''.
  maxContentRating: ['', (v) => (['', 'G', 'PG', 'PG-13', 'R', 'NC-17'].includes(v) ? v : 'PG-13')],
  limitNowPlaying: [true, bool],

  // Display protection
  sleepEnabled: [false, bool],
  sleepStart: ['01:00', hhmm],
  sleepEnd: ['07:00', hhmm],
  idleSleepHours: [0, strictNum(0, 48, { int: true })],
  wakeOnPlayback: [true, bool],
  pixelShift: [true, bool],
  pixelShiftMinutes: [3, strictNum(1, 60, { int: true })],
  frameBrightness: [100, strictNum(10, 100)],
  nightDim: [false, bool],
  nightDimStart: ['22:00', hhmm],
  nightDimEnd: ['07:00', hhmm],
  nightDimLevel: [60, strictNum(10, 100)],
  nightDimTarget: ['frame', oneOf('frame', 'stage')],
  dailyReload: [true, bool],
  dailyReloadTime: ['04:00', hhmm],

  // Kiosk
  kioskMode: [false, bool],
  disableShortcuts: [false, bool],
  settingsPinHash: ['', hex],
  settingsPinSalt: ['', hex],
  deviceHelper: [false, bool],

  // Now playing
  showMeta: [false, bool],
  showProgress: [true, bool],
  showPlayer: [false, bool],
};

/** Keys that hold secrets and are optional on export. */
export const SECRET_KEYS = ['plexToken'];

/** PIN material: never written to an export and never accepted from an import file. */
export const NEVER_EXPORT_KEYS = ['settingsPinHash', 'settingsPinSalt'];

export function defaults() {
  return Object.fromEntries(Object.entries(SCHEMA).map(([k, [d]]) => [k, d]));
}

/** Returns a complete, valid settings object; unknown keys are dropped. */
export function sanitize(input = {}) {
  const out = {};
  for (const [key, [def, fix]] of Object.entries(SCHEMA)) {
    out[key] = key in input && input[key] !== undefined && input[key] !== null ? fix(input[key], def) : def;
  }
  return out;
}

export function isConfigured(s) {
  return Boolean(s.plexToken && s.serverUrl && (s.libraryKey || s.staticRatingKey));
}

/**
 * Settings written by the original single-file app used one localStorage key per value.
 * Connection details carry over; poster geometry used a different model so it resets.
 */
const LEGACY_KEYS = {
  PLEX_TOKEN: 'plexToken',
  PLEX_SERVER_URL: 'serverUrl',
  PLEX_USERNAME: 'username',
  LIBRARY_KEY: 'libraryKey',
  REFRESH_INTERVAL_MS: 'rotateSeconds',
};
const LEGACY_DROP = ['FRAME_PATH', 'POSTER_SCALE', 'POSTER_OFFSET_X', 'POSTER_OFFSET_Y'];

/** Accepts the old CONFIG object shape (PLEX_TOKEN, …) in imported files. */
function translateLegacyShape(obj) {
  const out = { ...obj };
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    if (!(oldKey in out)) continue;
    if (!(newKey in out)) out[newKey] = newKey === 'rotateSeconds' ? Math.round(Number(out[oldKey]) / 1000) : out[oldKey];
    delete out[oldKey];
  }
  return out;
}

export function migrateLegacy(storage) {
  const found = {};
  let any = false;
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    const v = storage.getItem(oldKey);
    if (v === null) continue;
    any = true;
    found[newKey] = newKey === 'rotateSeconds' ? Math.round(Number(v) / 1000) : v;
  }
  if (!any) return null;
  for (const k of [...Object.keys(LEGACY_KEYS), ...LEGACY_DROP]) storage.removeItem(k);
  return found;
}

export function load(storage) {
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
  } catch {
    raw = null;
  }
  if (!raw) {
    const legacy = migrateLegacy(storage);
    if (legacy) {
      const migrated = sanitize(legacy);
      save(storage, migrated);
      return { settings: migrated, source: 'legacy' };
    }
    return { settings: defaults(), source: 'defaults' };
  }
  return { settings: sanitize(raw), source: 'storage' };
}

export function save(storage, settings) {
  const clean = sanitize(settings);
  storage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export function toExport(settings, { includeSecrets = false } = {}) {
  const data = sanitize(settings);
  if (!includeSecrets) for (const k of SECRET_KEYS) delete data[k];
  for (const k of NEVER_EXPORT_KEYS) delete data[k];
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), settings: data };
}

/**
 * Parses an exported file (or a bare settings object, e.g. a hand-written config.json)
 * and merges it over `current`. Throws with a readable message on bad input.
 */
export function fromImport(text, current = defaults()) {
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  let incoming = parsed;
  if (parsed.format !== undefined) {
    if (parsed.format !== EXPORT_FORMAT) throw new Error(`Unknown file format "${parsed.format}".`);
    if (Number(parsed.version) > EXPORT_VERSION) throw new Error('File was exported by a newer version of the app.');
    incoming = parsed.settings || {};
  }
  incoming = translateLegacyShape(incoming);
  const known = Object.keys(incoming).filter((k) => k in SCHEMA && !NEVER_EXPORT_KEYS.includes(k));
  if (known.length === 0) throw new Error('No recognised settings in file.');
  const merged = { ...current };
  for (const k of known) merged[k] = incoming[k];
  return sanitize(merged);
}
