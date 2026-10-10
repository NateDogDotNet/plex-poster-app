// Decides which poster should be on screen. Has no DOM access so it can be unit-tested;
// main.js calls `decide()` on a timer and renders whatever it returns.

import { pickNowPlaying } from './plex.js';
import { allows } from './ratings.js';

const POOL_TTL_MS = 30 * 60 * 1000;
const HISTORY = 10;
const RECHECK_BATCH = 100; // cached titles asked about per re-rating request (D37)
const RECHECK_REQUESTS = 3; // the poster cache holds at most 300 titles, so one pool load makes at most 3 requests

/**
 * `cachedKeys()` lists the rating keys in the offline poster cache and `onRatings(posters)` receives their current
 * ratings (D37). Both are optional: without them nothing is re-checked.
 */
export function createEngine({ client, getSettings, now = () => Date.now(), random = Math.random, cachedKeys = () => [], onRatings = () => {} }) {
  let current = null;
  let session = null; // the latest now-playing snapshot (what the last decide() saw), null when none
  let lastRotateAt = 0;
  let pool = [];
  let poolKey = '';
  let poolAt = 0;
  const recent = [];

  async function loadPool(s) {
    const key = `${s.libraryKey}|${s.unwatchedOnly}|${s.randomPoolSize}|${s.maxContentRating}`;
    if (pool.length && key === poolKey && now() - poolAt < POOL_TTL_MS) return pool;
    const loaded = await client.pool({ libraryKey: s.libraryKey, unwatchedOnly: s.unwatchedOnly, size: s.randomPoolSize, maxContentRating: s.maxContentRating });
    if (s.maxContentRating) await recheckCachedRatings();
    pool = loaded;
    poolKey = key;
    poolAt = now();
    return pool;
  }

  /**
   * While a household limit is set, every online pool load re-fetches ALL the cached titles' ratings (D37): a title
   * re-rated upward since it was cached must not come back from the offline cache. The keys go in batches of
   * RECHECK_BATCH (`GET /library/metadata/<k1>,<k2>,...`), at most RECHECK_REQUESTS requests. A title the response
   * does not return, a batch that fails, and any key not asked about at all are stored as unrated, which the offline
   * fallback skips under a limit (fails closed). A title merely absent from the random pool says nothing about its rating.
   */
  async function recheckCachedRatings() {
    const keys = cachedKeys();
    if (!keys.length) return;
    const byKey = new Map();
    for (let n = 0; n < RECHECK_REQUESTS && n * RECHECK_BATCH < keys.length; n++) {
      try {
        for (const p of await client.items(keys.slice(n * RECHECK_BATCH, (n + 1) * RECHECK_BATCH))) byKey.set(p.ratingKey, p);
      } catch {
        // nothing in this batch is confirmed: its keys are stored as unrated below
      }
    }
    onRatings(keys.map((k) => byKey.get(k) ?? { ratingKey: k, contentRating: '' }));
  }

  /** The sessions to look at: those already in hand, else a fetch. A refused call (401/403) means nothing is playing (K18). */
  async function sessionList(sessions, sessionsError) {
    if (sessions !== undefined) return sessions;
    try {
      if (sessionsError) throw sessionsError; // the caller's poll already failed this tick: no second request (C8M1)
      return await client.sessions();
    } catch (err) {
      if (err?.kind === 'auth') return [];
      throw err;
    }
  }

  // The one place the limit is enforced for server-supplied posters: random picks and now-playing both
  // go through it, whatever Plex returned. (A pinned poster is exempt and never does.)
  const permitted = (s, poster) => allows(s.maxContentRating, poster.contentRating);

  function pickRandom(items) {
    const fresh = items.filter((p) => !recent.includes(p.ratingKey) && p.ratingKey !== current?.ratingKey);
    const from = fresh.length ? fresh : items.filter((p) => p.ratingKey !== current?.ratingKey);
    const list = from.length ? from : items;
    return list[Math.floor(random() * list.length)] || null;
  }

  return {
    get current() {
      return current;
    },

    /**
     * The now-playing session seen by the latest decide(), as a poster descriptor with `viewOffset`, `duration`,
     * `playerTitle` and `paused`; null when nothing is playing, `showNowPlaying` is off, or the limit hides it.
     * Updated even when decide() returns null because the poster is unchanged.
     */
    get session() {
      return session;
    },

    /** Records what is actually displayed (including cached fallbacks). */
    shown(poster) {
      current = { ...poster, shownAt: now() };
      if (poster.source === 'random' || poster.source === 'cache') {
        lastRotateAt = now();
        recent.unshift(poster.ratingKey);
        recent.length = Math.min(recent.length, HISTORY);
      }
    },

    invalidate() {
      pool = [];
      poolKey = '';
    },

    /**
     * The session that counts as playback (honours `username` and `includeEpisodes`, even when
     * `showNowPlaying` is off), or null. Fetches no art and records nothing as shown; sleep mode
     * uses it to watch for playback while the screen is black. Throws PlexError like `decide()`.
     * Pass the `/status/sessions` result already in hand to avoid a second request.
     */
    async playing(sessions) {
      return pickNowPlaying(sessions ?? (await client.sessions()), getSettings());
    },

    /**
     * Returns `{ poster, reason }` when the display should change, or null to keep the
     * current poster. Throws PlexError on connection problems. `sessions` is a `/status/sessions`
     * result the caller already fetched this tick (one request per tick); omitted, it is fetched here.
     * `sessionsError` is the error of the caller's own failed sessions request this tick: it is not asked for again.
     */
    async decide({ force = false, sessions, sessionsError } = {}) {
      const s = getSettings();

      // Now playing wins over everything; a pinned poster replaces random rotation.
      session = null;
      if (s.showNowPlaying) {
        let np = pickNowPlaying(await sessionList(sessions, sessionsError), s);
        if (np && s.limitNowPlaying !== false && !permitted(s, np)) np = null; // above the limit or unrated: nothing is playing
        session = np;
        if (np) {
          if (!force && current?.source === 'now-playing' && current.ratingKey === np.ratingKey) return null;
          return { poster: np, reason: np.user ? `now playing for ${np.user}` : 'now playing' };
        }
      }

      if (s.staticRatingKey) {
        if (!force && current?.ratingKey === s.staticRatingKey && current.source !== 'cache') return null;
        return { poster: await client.item(s.staticRatingKey), reason: 'static poster' };
      }

      if (!s.libraryKey) return null;
      const playbackEnded = current?.source === 'now-playing';
      const due = now() - lastRotateAt >= s.rotateSeconds * 1000;
      if (!force && !playbackEnded && !due && current) return null;

      const next = pickRandom((await loadPool(s)).filter((p) => permitted(s, p)));
      if (!next) {
        const hint = s.maxContentRating ? ` at or below ${s.maxContentRating} (try turning off "unwatched only" or raise the limit)` : ' (try turning off "unwatched only")';
        throw Object.assign(new Error(`No posters found in that library${hint}.`), { kind: 'empty' });
      }
      return { poster: next, reason: playbackEnded ? 'playback ended' : force ? 'manual refresh' : 'rotation' };
    },
  };
}
