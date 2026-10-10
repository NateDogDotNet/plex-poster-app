// Decides which poster should be on screen. Has no DOM access so it can be unit-tested;
// main.js calls `decide()` on a timer and renders whatever it returns.

import { pickNowPlaying } from './plex.js';
import { allows } from './ratings.js';

const POOL_TTL_MS = 30 * 60 * 1000;
const HISTORY = 10;

export function createEngine({ client, getSettings, now = () => Date.now(), random = Math.random }) {
  let current = null;
  let lastRotateAt = 0;
  let pool = [];
  let poolKey = '';
  let poolAt = 0;
  const recent = [];

  async function loadPool(s) {
    const key = `${s.libraryKey}|${s.unwatchedOnly}|${s.randomPoolSize}|${s.maxContentRating}`;
    if (pool.length && key === poolKey && now() - poolAt < POOL_TTL_MS) return pool;
    pool = await client.pool({ libraryKey: s.libraryKey, unwatchedOnly: s.unwatchedOnly, size: s.randomPoolSize, maxContentRating: s.maxContentRating });
    poolKey = key;
    poolAt = now();
    return pool;
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
     */
    async decide({ force = false, sessions } = {}) {
      const s = getSettings();

      // Now playing wins over everything; a pinned poster replaces random rotation.
      if (s.showNowPlaying) {
        let np = pickNowPlaying(sessions ?? (await client.sessions()), s);
        if (np && s.limitNowPlaying !== false && !permitted(s, np)) np = null; // above the limit or unrated: nothing is playing
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
