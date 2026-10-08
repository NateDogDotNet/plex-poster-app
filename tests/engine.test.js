import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../js/engine.js';
import { defaults } from '../js/settings.js';

function fakeClient({ sessions = [], pool = [] } = {}) {
  const calls = { pool: 0, sessions: 0, item: 0 };
  return {
    calls,
    sessions: async () => (calls.sessions++, sessions),
    pool: async () => (calls.pool++, pool),
    item: async (key) => (calls.item++, { ratingKey: key, title: `Item ${key}`, thumb: `/t/${key}`, source: 'static' }),
  };
}

const poster = (k) => ({ ratingKey: k, title: `Movie ${k}`, thumb: `/t/${k}`, source: 'random' });

function setup(overrides = {}, clientOpts = {}) {
  let t = 1_000_000;
  const settings = { ...defaults(), plexToken: 't', serverUrl: 'http://s', libraryKey: '1', ...overrides };
  const client = fakeClient(clientOpts);
  const engine = createEngine({ client, getSettings: () => settings, now: () => t, random: () => 0 });
  return { engine, client, settings, advance: (ms) => (t += ms) };
}

test('first decision picks a random poster; later ones wait for the rotation interval', async () => {
  const { engine, advance } = setup({ rotateSeconds: 60 }, { pool: [poster('a'), poster('b')] });
  const first = await engine.decide();
  assert.equal(first.reason, 'rotation');
  engine.shown(first.poster);

  advance(30_000);
  assert.equal(await engine.decide(), null);

  advance(31_000);
  const next = await engine.decide();
  assert.notEqual(next.poster.ratingKey, first.poster.ratingKey);
});

test('force always produces a new poster', async () => {
  const { engine } = setup({}, { pool: [poster('a'), poster('b')] });
  engine.shown((await engine.decide()).poster);
  const forced = await engine.decide({ force: true });
  assert.equal(forced.reason, 'manual refresh');
});

test('now playing takes over and rotation resumes when playback ends', async () => {
  const sessions = [{ type: 'movie', ratingKey: 'np', title: 'Playing', thumb: '/t/np', User: { title: 'me' }, Player: { state: 'playing' } }];
  const { engine, client } = setup({}, { sessions, pool: [poster('a')] });
  const d = await engine.decide();
  assert.equal(d.poster.source, 'now-playing');
  engine.shown(d.poster);
  assert.equal(await engine.decide(), null, 'same session does not re-render');

  sessions.length = 0;
  const after = await engine.decide();
  assert.equal(after.reason, 'playback ended');
  assert.equal(client.calls.pool, 1);
});

test('the random pool is cached between rotations', async () => {
  const { engine, client, advance } = setup({ rotateSeconds: 10 }, { pool: [poster('a'), poster('b')] });
  for (let i = 0; i < 4; i++) {
    engine.shown((await engine.decide({ force: true })).poster);
    advance(11_000);
  }
  assert.equal(client.calls.pool, 1);
});

test('recent posters are avoided', async () => {
  const pool = ['a', 'b', 'c'].map(poster);
  const { engine } = setup({}, { pool });
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const d = await engine.decide({ force: true });
    engine.shown(d.poster);
    seen.push(d.poster.ratingKey);
  }
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
});

test('a pinned poster replaces rotation but not now playing', async () => {
  const sessions = [];
  const { engine, client, advance } = setup({ staticRatingKey: '42', rotateSeconds: 10 }, { sessions, pool: [poster('a')] });
  const d = await engine.decide();
  assert.equal(d.poster.ratingKey, '42');
  engine.shown(d.poster);
  advance(60_000);
  assert.equal(await engine.decide(), null);
  assert.equal(client.calls.pool, 0);

  sessions.push({ type: 'movie', ratingKey: 'np', title: 'Playing', thumb: '/t/np' });
  assert.equal((await engine.decide()).poster.source, 'now-playing');
});

test('an empty library is reported', async () => {
  const { engine } = setup({}, { pool: [] });
  await assert.rejects(engine.decide(), { kind: 'empty' });
});
