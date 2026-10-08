import test from 'node:test';
import assert from 'node:assert/strict';
import { createPosterCache } from '../js/poster-cache.js';

globalThis.location ??= { origin: 'http://localhost' };

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// Minimal Cache API: records every put/delete/match so tests can assert on writes.
function fakeCaches({ matchThrows = false } = {}) {
  const store = new Map();
  const calls = { put: 0, delete: [], match: 0 };
  const cache = {
    async put(url, res) {
      calls.put++;
      store.set(url, res);
    },
    async match(url) {
      calls.match++;
      if (matchThrows) throw new Error('boom');
      const res = store.get(url);
      return res ? res.clone() : undefined;
    },
    async delete(url) {
      calls.delete.push(url);
      return store.delete(url);
    },
  };
  return { caches: { open: async () => cache, delete: async () => true }, store, calls };
}

const poster = (n, thumb = `/t/${n}`) => ({ ratingKey: String(n), title: `P${n}`, year: 2000 + n, thumb });
const blob = (text = 'img') => new Blob([text], { type: 'image/jpeg' });
const size = (width, height = width * 1.5) => ({ width, height });

test('hit: same thumb and enough width returns the stored blob', async () => {
  const f = fakeCaches();
  const pc = createPosterCache({ storage: memoryStorage(), caches: f.caches });
  await pc.put(poster(1), blob('one'), size(600));
  const hit = await pc.lookup(poster(1), size(600));
  assert.equal(await hit.text(), 'one');
});

test('miss: nothing stored', async () => {
  const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches });
  assert.equal(await pc.lookup(poster(1), size(600)), null);
});

test('miss: thumb changed', async () => {
  const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches });
  await pc.put(poster(1, '/t/old'), blob(), size(600));
  assert.equal(await pc.lookup(poster(1, '/t/new'), size(600)), null);
});

test('miss: stored width smaller than requested', async () => {
  const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches });
  await pc.put(poster(1), blob(), size(400));
  assert.equal(await pc.lookup(poster(1), size(500)), null);
});

test('hit: stored width larger than requested', async () => {
  const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches });
  await pc.put(poster(1), blob(), size(800));
  assert.ok(await pc.lookup(poster(1), size(500)));
});

test('miss: entry without a recorded width (older index)', async () => {
  const storage = memoryStorage();
  storage.setItem('plexPoster.posterIndex', JSON.stringify([{ ratingKey: '1', thumb: '/t/1' }]));
  const pc = createPosterCache({ storage, caches: fakeCaches().caches });
  assert.equal(await pc.lookup(poster(1), size(100)), null);
});

test('miss: the Cache API get throwing', async () => {
  const storage = memoryStorage(); // shared, so the second cache sees the index the first wrote
  const good = createPosterCache({ storage, caches: fakeCaches().caches });
  await good.put(poster(1), blob(), size(600));
  const broken = createPosterCache({ storage, caches: fakeCaches({ matchThrows: true }).caches });
  assert.equal(await broken.lookup(poster(1), size(600)), null);
});

test('artwork change: miss, then one put, then served from the cache', async () => {
  const f = fakeCaches();
  const pc = createPosterCache({ storage: memoryStorage(), caches: f.caches });
  await pc.put(poster(1, '/t/old'), blob('old'), size(600));
  const changed = poster(1, '/t/new');
  assert.equal(await pc.lookup(changed, size(600)), null); // the one download
  await pc.put(changed, blob('new'), size(600));
  assert.equal(f.calls.put, 2);
  for (let i = 0; i < 3; i++) assert.equal(await (await pc.lookup(changed, size(600))).text(), 'new');
  assert.equal(f.calls.put, 2); // no further writes
  assert.equal(pc.entries().length, 1);
});

test('a non-numeric or non-finite limit falls back to 100 instead of emptying the cache', async () => {
  for (const bad of [undefined, NaN, 'abc', Infinity, null, '', false, [], 0, -5, '  ']) {
    const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches, limit: () => bad });
    await pc.put(poster(1), blob(), size(600));
    await pc.put(poster(2), blob(), size(600));
    assert.equal(pc.entries().length, 2, `limit ${String(bad)}`);
  }
});

test('delete removes the blob and the index entry', async () => {
  const f = fakeCaches();
  const pc = createPosterCache({ storage: memoryStorage(), caches: f.caches });
  await pc.put(poster(1), blob(), size(600));
  await pc.put(poster(2), blob(), size(600));
  await pc.delete('1');
  assert.deepEqual(pc.entries().map((e) => e.ratingKey), ['2']);
  assert.equal(f.store.size, 1);
});

test('miss: index says stored but the blob is gone', async () => {
  const f = fakeCaches();
  const pc = createPosterCache({ storage: memoryStorage(), caches: f.caches });
  await pc.put(poster(1), blob(), size(600));
  f.store.clear();
  assert.equal(await pc.lookup(poster(1), size(600)), null);
});

test('a hit neither writes the cache nor re-orders or rewrites the index', async () => {
  const f = fakeCaches();
  const storage = memoryStorage();
  let writes = 0;
  const counting = { ...storage, setItem: (k, v) => (writes++, storage.setItem(k, v)) };
  const pc = createPosterCache({ storage: counting, caches: f.caches });
  await pc.put(poster(1), blob(), size(600));
  await pc.put(poster(2), blob(), size(600));
  const putsBefore = f.calls.put;
  const writesBefore = writes;
  const orderBefore = pc.entries().map((e) => e.ratingKey);
  await pc.lookup(poster(1), size(600));
  assert.equal(f.calls.put, putsBefore);
  assert.equal(writes, writesBefore);
  assert.deepEqual(pc.entries().map((e) => e.ratingKey), orderBefore);
});

test('put records width and height in the index entry', async () => {
  const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches });
  await pc.put(poster(1), blob(), size(600, 900));
  const [e] = pc.entries();
  assert.equal(e.width, 600);
  assert.equal(e.height, 900);
  assert.equal(e.thumb, '/t/1');
});

test('the default limit is 100 when none is given', async () => {
  const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches });
  for (let i = 1; i <= 40; i++) await pc.put(poster(i), blob(), size(600));
  assert.equal(pc.entries().length, 40);
});

test('limit as a function is re-read on each put', async () => {
  let limit = 3;
  const pc = createPosterCache({ storage: memoryStorage(), caches: fakeCaches().caches, limit: () => limit });
  for (let i = 1; i <= 4; i++) await pc.put(poster(i), blob(), size(600));
  assert.equal(pc.entries().length, 3);
  limit = 2;
  await pc.put(poster(5), blob(), size(600));
  assert.deepEqual(pc.entries().map((e) => e.ratingKey), ['5', '4']);
  limit = 10;
  await pc.put(poster(6), blob(), size(600));
  assert.equal(pc.entries().length, 3);
});

test('eviction deletes the evicted entries from the cache', async () => {
  const f = fakeCaches();
  const pc = createPosterCache({ storage: memoryStorage(), caches: f.caches, limit: 2 });
  for (let i = 1; i <= 4; i++) await pc.put(poster(i), blob(), size(600));
  assert.equal(f.calls.delete.length, 2);
  assert.ok(f.calls.delete.some((u) => u.endsWith('/__posters__/1')));
  assert.ok(f.calls.delete.some((u) => u.endsWith('/__posters__/2')));
  assert.equal(f.store.size, 2);
  assert.equal(await pc.lookup(poster(1), size(600)), null);
});

test('unavailable caches: lookup is a miss, put is a no-op', async () => {
  const pc = createPosterCache({ storage: memoryStorage(), caches: undefined });
  assert.equal(pc.available, false);
  assert.equal(await pc.lookup(poster(1), size(600)), null);
  await pc.put(poster(1), blob(), size(600));
});
