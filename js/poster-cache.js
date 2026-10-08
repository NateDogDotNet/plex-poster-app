// Keeps the most recently shown posters (image + metadata) in the Cache API so the
// display keeps cycling real artwork while the Plex server is unreachable.

const CACHE_NAME = 'plex-posters-v1';
const INDEX_KEY = 'plexPoster.posterIndex';
const PREFIX = '/__posters__/';

export function createPosterCache({ storage, limit = 30, caches = globalThis.caches } = {}) {
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

    /** Stores a poster blob, most recent first, evicting beyond `limit`. */
    async put(poster, blob) {
      if (!available) return;
      const cache = await caches.open(CACHE_NAME);
      await cache.put(keyUrl(poster.ratingKey), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
      const meta = { ratingKey: poster.ratingKey, title: poster.title, year: poster.year, thumb: poster.thumb, savedAt: Date.now() };
      const list = [meta, ...readIndex().filter((e) => e.ratingKey !== poster.ratingKey)];
      const evicted = list.splice(limit);
      writeIndex(list);
      await Promise.all(evicted.map((e) => cache.delete(keyUrl(e.ratingKey))));
    },

    async get(ratingKey) {
      if (!available) return null;
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(keyUrl(ratingKey));
      return res ? res.blob() : null;
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
