// Keeps the most recently shown posters (image + metadata) in the Cache API so the
// display keeps cycling real artwork while the Plex server is unreachable.

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
      const meta = { ratingKey: poster.ratingKey, title: poster.title, year: poster.year, thumb: poster.thumb, width: size.width, height: size.height, savedAt: Date.now() };
      const list = [meta, ...readIndex().filter((e) => e.ratingKey !== poster.ratingKey)];
      const evicted = list.splice(maxEntries());
      writeIndex(list);
      await Promise.all(evicted.map((e) => cache.delete(keyUrl(e.ratingKey))));
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

    /** A random cached poster other than `excludeKey`, with its blob. */
    async random(excludeKey) {
      const list = readIndex();
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
