// Keeps the most recently shown posters (image + metadata) in the Cache API so the
// display keeps cycling real artwork while the Plex server is unreachable.

import { allows } from './ratings.js';

const CACHE_NAME = 'plex-posters-v1';
const INDEX_KEY = 'plexPoster.posterIndex';
const PREFIX = '/__posters__/';

const DEFAULT_LIMIT = 100;

// `limit` is a number or a function returning one, re-read on every put so a settings change applies.
export function createPosterCache({ storage, limit = DEFAULT_LIMIT, caches = globalThis.caches } = {}) {
  const maxEntries = () => {
    const v = typeof limit === 'function' ? limit() : limit;
    const numeric = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');
    const n = numeric ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_LIMIT; // junk or < 1 falls back to the default, never empties the cache
  };
  const available = Boolean(caches && typeof caches.open === 'function');

  const readIndex = () => {
    try {
      const list = JSON.parse(storage.getItem(INDEX_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (list) => {
    try {
      storage.setItem(INDEX_KEY, JSON.stringify(list));
    } catch {
      // storage full or blocked — cache still works for this session
    }
  };
  const keyUrl = (ratingKey) => new URL(PREFIX + encodeURIComponent(ratingKey), location.origin).toString();

  return {
    available,

    entries() {
      return readIndex();
    },

    /** Stores a poster blob (rendered at `size`), most recent first, evicting beyond `limit`. */
    async put(poster, blob, size = {}) {
      if (!available) return;
      const cache = await caches.open(CACHE_NAME);
      await cache.put(keyUrl(poster.ratingKey), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
      const meta = { ratingKey: poster.ratingKey, title: poster.title, year: poster.year, thumb: poster.thumb, contentRating: poster.contentRating || '', ...(poster.duration ? { duration: poster.duration } : {}), width: size.width, height: size.height, savedAt: Date.now() };
      const list = [meta, ...readIndex().filter((e) => e.ratingKey !== poster.ratingKey)];
      const evicted = list.splice(maxEntries());
      writeIndex(list);
      await Promise.all(evicted.map((e) => cache.delete(keyUrl(e.ratingKey))));
    },

    /**
     * A poster seen online carries its current rating: store it, so a re-rated title does not keep its old rating
     * for the offline fallback. Only the rating of an existing entry changes (no re-order, no blob write); nothing
     * is written when it already matches or the poster is not cached.
     */
    refreshRating(poster) {
      const list = readIndex();
      const entry = list.find((e) => e.ratingKey === poster.ratingKey);
      const contentRating = poster.contentRating || '';
      if (!entry || entry.contentRating === contentRating) return;
      entry.contentRating = contentRating;
      writeIndex(list);
    },

    /** Drops one poster (blob and index entry), e.g. when its stored blob proves undecodable. */
    async delete(ratingKey) {
      writeIndex(readIndex().filter((e) => e.ratingKey !== ratingKey));
      if (!available) return;
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(keyUrl(ratingKey));
    },

    async get(ratingKey) {
      if (!available) return null;
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(keyUrl(ratingKey));
      return res ? res.blob() : null;
    },

    /**
     * The stored blob when it is still valid for `poster` at `size`: same thumb and a stored width at
     * least as large as requested. Any other outcome, including an error, is a miss (null). Read-only:
     * no cache write and no index re-order, so a hit costs no flash/SD writes.
     */
    async lookup(poster, size) {
      if (!available) return null;
      const entry = readIndex().find((e) => e.ratingKey === poster.ratingKey);
      if (!entry || entry.thumb !== poster.thumb || !(entry.width >= size.width)) return null;
      try {
        return await this.get(poster.ratingKey);
      } catch {
        return null;
      }
    },

    /**
     * A random cached poster other than `excludeKey`, with its blob. While `maxContentRating` is set, entries
     * above it and entries with no stored rating (cached before 2.1) are never returned.
     */
    async random(excludeKey, maxContentRating = '') {
      const list = readIndex().filter((e) => allows(maxContentRating, e.contentRating));
      const pool = list.length > 1 ? list.filter((e) => e.ratingKey !== excludeKey) : list;
      for (const meta of pool.sort(() => Math.random() - 0.5)) {
        const blob = await this.get(meta.ratingKey);
        if (blob) return { poster: { ...meta, source: 'cache' }, blob };
      }
      return null;
    },

    async clear() {
      writeIndex([]);
      if (available) await caches.delete(CACHE_NAME);
    },
  };
}
