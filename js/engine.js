// Decides which poster should be on screen. Has no DOM access so it can be unit-tested;
// main.js calls `decide()` on a timer and renders whatever it returns.

import { pickNowPlaying } from './plex.js';

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
    const key = `${s.libraryKey}|${s.unwatchedOnly}|${s.randomPoolSize}`;
    if (pool.length && key === poolKey && now() - poolAt < POOL_TTL_MS) return pool;
    pool = await client.pool({ libraryKey: s.libraryKey, unwatchedOnly: s.unwatchedOnly, size: s.randomPoolSize });
    poolKey = key;
    poolAt = now();
    return pool;
  }

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
     * Returns `{ poster, reason }` when the display should change, or null to keep the
     * current poster. Throws PlexError on connection problems.
     */
    async decide({ force = false } = {}) {
      const s = getSettings();

      // Now playing wins over everything; a pinned poster replaces random rotation.
      if (s.showNowPlaying) {
        const np = pickNowPlaying(await client.sessions(), s);
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

      const next = pickRandom(await loadPool(s));
      if (!next) throw Object.assign(new Error('No posters found in that library (try turning off "unwatched only").'), { kind: 'empty' });
      return { poster: next, reason: playbackEnded ? 'playback ended' : force ? 'manual refresh' : 'rotation' };
    },
  };
}
