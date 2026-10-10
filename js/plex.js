// Minimal Plex Media Server + plex.tv client.
//
// Requests deliberately stay CORS-"simple" (GET/POST, only an Accept header, token in
// the query string) so browsers don't send a preflight that some Plex servers reject.

import { allowedValues } from './ratings.js';

export const PRODUCT = 'Plex Poster Display';
const PLEX_TV = 'https://plex.tv';

export class PlexError extends Error {
  constructor(message, { status = 0, kind = 'network' } = {}) {
    super(message);
    this.name = 'PlexError';
    this.status = status;
    this.kind = kind; // 'network' | 'timeout' | 'auth' | 'http' | 'parse'
  }
}

/** Builds a URL with query params; values that are '' / null / undefined are skipped. */
export function buildUrl(base, path, params = {}) {
  const url = new URL(path, base.endsWith('/') ? base : base + '/');
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** Converts a Plex XML MediaContainer into the same shape as the JSON API. */
export function xmlToContainer(doc) {
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
    throw new PlexError('Could not parse Plex response.', { kind: 'parse' });
  }
  const attrs = (el) => Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));
  const container = attrs(root);
  const items = [];
  const dirs = [];
  for (const child of Array.from(root.children)) {
    const obj = attrs(child);
    for (const sub of Array.from(child.children)) {
      if (['User', 'Player', 'Session'].includes(sub.nodeName)) obj[sub.nodeName] = attrs(sub);
    }
    // JSON puts library sections under Directory and items under Metadata; show
    // libraries return <Directory> items too, so list Directory elements in both.
    if (child.nodeName === 'Directory') dirs.push(obj);
    items.push(obj);
  }
  if (items.length) container.Metadata = items;
  if (dirs.length) container.Directory = dirs;
  return container;
}

export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function request(url, { method = 'GET', timeoutMs = 10000, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method, headers: { Accept: 'application/json' }, signal: timeoutSignal(timeoutMs) });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new PlexError(timedOut ? 'Plex did not respond in time.' : 'Could not reach Plex (network or CORS error).', {
      kind: timedOut ? 'timeout' : 'network',
    });
  }
  if (res.status === 401 || res.status === 403) {
    throw new PlexError('Plex rejected the token (unauthorised).', { status: res.status, kind: 'auth' });
  }
  if (!res.ok) throw new PlexError(`Plex returned HTTP ${res.status}.`, { status: res.status, kind: 'http' });

  const text = await res.text();
  if (!text.trim()) return {};
  if (text.trimStart().startsWith('<')) {
    if (typeof DOMParser === 'undefined') throw new PlexError('Unexpected XML response.', { kind: 'parse' });
    return xmlToContainer(new DOMParser().parseFromString(text, 'application/xml'));
  }
  try {
    const json = JSON.parse(text);
    return json.MediaContainer ?? json;
  } catch {
    throw new PlexError('Could not parse Plex response.', { kind: 'parse' });
  }
}

/**
 * Picks the session poster to show from /status/sessions.
 * Prefers the given user's playing (over paused) session; episodes use the show poster.
 */
export function pickNowPlaying(sessions, { username = '', includeEpisodes = true } = {}) {
  const want = username.trim().toLowerCase();
  const candidates = (sessions || [])
    .filter((m) => m.type === 'movie' || (includeEpisodes && m.type === 'episode'))
    .filter((m) => !want || (m.User?.title || '').toLowerCase() === want)
    .map((m) => ({ ...m, _poster: m.type === 'episode' ? m.grandparentThumb || m.parentThumb || m.thumb : m.thumb }))
    .filter((m) => m._poster);
  if (!candidates.length) return null;
  const rank = (m) => (m.Player?.state === 'playing' ? 0 : m.Player?.state === 'buffering' ? 1 : 2);
  candidates.sort((a, b) => rank(a) - rank(b));
  return toPoster(candidates[0], 'now-playing');
}

/** Normalised poster descriptor used throughout the app. */
export function toPoster(m, source) {
  const isEpisode = m.type === 'episode';
  const thumb = m._poster || m.thumb;
  return {
    ratingKey: String(isEpisode ? m.grandparentRatingKey || m.ratingKey : m.ratingKey),
    title: isEpisode ? m.grandparentTitle || m.title : m.title,
    year: isEpisode ? '' : m.year ? String(m.year) : '',
    thumb,
    source, // 'now-playing' | 'random' | 'static' | 'cache'
    user: m.User?.title || '',
    contentRating: typeof m.contentRating === 'string' ? m.contentRating : '', // '' = unrated or missing
  };
}

export function createPlexClient({ serverUrl, token, clientId, fetchImpl = (...a) => fetch(...a) }) {
  const auth = { 'X-Plex-Token': token, 'X-Plex-Client-Identifier': clientId, 'X-Plex-Product': PRODUCT };
  const get = (path, params = {}, opts = {}) => request(buildUrl(serverUrl, path, { ...params, ...auth }), { ...opts, fetchImpl });

  return {
    /** Server identity; succeeds only when the URL and token are good. */
    async identity() {
      const c = await get('/', {}, { timeoutMs: 8000 });
      return { name: c.friendlyName || '', version: c.version || '', machineIdentifier: c.machineIdentifier || '' };
    },

    async libraries() {
      const c = await get('/library/sections');
      return (c.Directory || []).map((d) => ({ key: String(d.key), title: d.title, type: d.type }));
    },

    async sessions() {
      const c = await get('/status/sessions');
      return c.Metadata || [];
    },

    /**
     * Top-rated items in a library section, used as the random pool. With a `maxContentRating` it asks Plex
     * for the allowed ratings only and oversamples (3x, at most 500) because filtering shrinks the pool.
     * The server filter is a convenience (its syntax is unverified): the engine re-checks every poster.
     */
    async pool({ libraryKey, unwatchedOnly = true, size = 100, maxContentRating = '' }) {
      const c = await get(`/library/sections/${encodeURIComponent(libraryKey)}/all`, {
        unwatched: unwatchedOnly ? 1 : '',
        sort: 'rating:desc',
        contentRating: allowedValues(maxContentRating).join(','),
        'X-Plex-Container-Start': 0,
        'X-Plex-Container-Size': maxContentRating ? Math.min(size * 3, 500) : size,
      });
      return (c.Metadata || []).filter((m) => m.thumb).map((m) => toPoster(m, 'random'));
    },

    async item(ratingKey) {
      const c = await get(`/library/metadata/${encodeURIComponent(ratingKey)}`);
      const m = (c.Metadata || [])[0];
      if (!m) throw new PlexError('That library item no longer exists.', { kind: 'http', status: 404 });
      return toPoster(m, 'static');
    },

    /** A resized poster via the Plex photo transcoder — far lighter than the original artwork. */
    imageUrl(thumb, { width, height }) {
      return buildUrl(serverUrl, '/photo/:/transcode', {
        url: thumb,
        width: Math.round(width),
        height: Math.round(height),
        minSize: 1,
        upscale: 1,
        'X-Plex-Token': token,
      });
    },
  };
}

// ---- plex.tv sign-in (PIN / plex.tv/link flow) and server discovery ----

function tvParams(clientId, token) {
  return {
    'X-Plex-Product': PRODUCT,
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Device-Name': PRODUCT,
    'X-Plex-Token': token,
  };
}

/** Creates a short 4-character PIN the user enters at plex.tv/link. */
export async function createPin(clientId, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const pin = await request(buildUrl(PLEX_TV, '/api/v2/pins', { strong: 'false', ...tvParams(clientId) }), {
    method: 'POST',
    fetchImpl,
  });
  return { id: pin.id, code: pin.code, expiresAt: pin.expiresAt };
}

/** Resolves to the auth token once the PIN is claimed, or null while still pending. */
export async function checkPin(clientId, pinId, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const pin = await request(buildUrl(PLEX_TV, `/api/v2/pins/${pinId}`, tvParams(clientId)), { fetchImpl });
  return pin.authToken || null;
}

/**
 * Lists servers on the account with their connections ordered by preference.
 * On an https page only https connections are usable (browsers block mixed content).
 */
export async function discoverServers(clientId, token, { secureOnly = false, fetchImpl = (...a) => fetch(...a) } = {}) {
  const list = await request(
    buildUrl(PLEX_TV, '/api/v2/resources', { includeHttps: 1, includeRelay: 1, ...tvParams(clientId, token) }),
    { fetchImpl },
  );
  return (Array.isArray(list) ? list : [])
    .filter((r) => String(r.provides || '').split(',').includes('server'))
    .map((r) => ({
      name: r.name,
      owned: Boolean(r.owned),
      accessToken: r.accessToken || token,
      connections: rankConnections(r.connections || [], { secureOnly }),
    }))
    .filter((r) => r.connections.length);
}

export function rankConnections(connections, { secureOnly = false } = {}) {
  const score = (c) => (c.local ? 0 : 2) + (c.relay ? 4 : 0) + (c.protocol === 'https' ? 0 : 1);
  return connections
    .filter((c) => !secureOnly || c.protocol === 'https')
    .slice()
    .sort((a, b) => score(a) - score(b))
    .map((c) => ({ uri: c.uri, local: Boolean(c.local), relay: Boolean(c.relay), protocol: c.protocol }));
}

/** Tries each connection in order and returns the first that answers. */
export async function firstReachable(connections, token, clientId, { fetchImpl } = {}) {
  for (const c of connections) {
    try {
      await createPlexClient({ serverUrl: c.uri, token, clientId, fetchImpl }).identity();
      return c.uri;
    } catch {
      // try the next one
    }
  }
  return null;
}
