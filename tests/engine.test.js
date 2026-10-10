import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../js/engine.js';
import { defaults } from '../js/settings.js';

function fakeClient({ sessions = [], pool = [], itemRating = '' } = {}) {
  const calls = { pool: 0, sessions: 0, item: 0, poolArgs: [] };
  return {
    calls,
    sessions: async () => (calls.sessions++, sessions),
    pool: async (args) => (calls.pool++, calls.poolArgs.push(args), pool),
    item: async (key) => (calls.item++, { ratingKey: key, title: `Item ${key}`, thumb: `/t/${key}`, source: 'static', contentRating: itemRating }),
  };
}

const poster = (k) => ({ ratingKey: k, title: `Movie ${k}`, thumb: `/t/${k}`, source: 'random' });

function setup(overrides = {}, clientOpts = {}, random = () => 0) {
  let t = 1_000_000;
  const settings = { ...defaults(), plexToken: 't', serverUrl: 'http://s', libraryKey: '1', ...overrides };
  const client = fakeClient(clientOpts);
  const engine = createEngine({ client, getSettings: () => settings, now: () => t, random });
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

test('playing() returns the session without fetching art or touching the pool', async () => {
  const sessions = [{ type: 'movie', ratingKey: 'np', title: 'Playing', thumb: '/t/np', User: { title: 'me' }, Player: { state: 'playing' } }];
  const { engine, client } = setup({}, { sessions, pool: [poster('a')] });
  const np = await engine.playing();
  assert.equal(np.ratingKey, 'np');
  assert.equal(np.source, 'now-playing');
  assert.equal(client.calls.sessions, 1);
  assert.equal(client.calls.pool, 0);
  assert.equal(client.calls.item, 0);
  assert.equal(engine.current, null, 'playing() does not record anything as shown');
});

test('playing() returns null when nothing is playing', async () => {
  const { engine } = setup({}, { sessions: [] });
  assert.equal(await engine.playing(), null);
});

test('playing() works with showNowPlaying off', async () => {
  const sessions = [{ type: 'movie', ratingKey: 'np', title: 'Playing', thumb: '/t/np' }];
  const { engine } = setup({ showNowPlaying: false }, { sessions });
  assert.equal((await engine.playing())?.ratingKey, 'np');
});

test('playing() honours username and includeEpisodes', async () => {
  const sessions = [
    { type: 'episode', ratingKey: 'e1', grandparentRatingKey: 'show', grandparentTitle: 'Show', title: 'Ep', grandparentThumb: '/t/show', User: { title: 'Kid' } },
  ];
  assert.equal((await setup({ username: 'someone else' }, { sessions }).engine.playing()), null);
  assert.equal((await setup({ username: 'kid' }, { sessions }).engine.playing())?.ratingKey, 'show');
  assert.equal(await setup({ includeEpisodes: false }, { sessions }).engine.playing(), null);
});

test('playing() propagates a connection error', async () => {
  const client = { ...fakeClient(), sessions: async () => { throw Object.assign(new Error('down'), { kind: 'network' }); } };
  const engine = createEngine({ client, getSettings: () => ({ ...defaults(), libraryKey: '1' }) });
  await assert.rejects(engine.playing(), { kind: 'network' });
});

// One /status/sessions request per tick: main.js fetches the sessions once and hands them to both.
const NP = [{ type: 'movie', ratingKey: 'np', title: 'Playing', thumb: '/t/np', User: { title: 'me' }, Player: { state: 'playing' } }];

test('playing(sessions) uses the sessions it is given and fetches nothing', async () => {
  const { engine, client } = setup({}, { sessions: [], pool: [poster('a')] });
  assert.equal((await engine.playing(NP))?.ratingKey, 'np');
  assert.equal(await engine.playing([]), null);
  assert.equal(client.calls.sessions, 0);
});

test('decide({ sessions }) shows the given now-playing session without a second sessions request', async () => {
  const { engine, client } = setup({}, { sessions: [], pool: [poster('a')] });
  const d = await engine.decide({ sessions: NP });
  assert.equal(d.poster.source, 'now-playing');
  assert.equal(d.reason, 'now playing for me');
  assert.equal(client.calls.sessions, 0);
});

test('decide({ sessions: [] }) means nothing is playing: rotation, and still no sessions request', async () => {
  const { engine, client } = setup({}, { sessions: NP, pool: [poster('a')] });
  const d = await engine.decide({ sessions: [] });
  assert.equal(d.poster.source, 'random');
  assert.equal(client.calls.sessions, 0);
});

test('decide() without sessions still fetches them itself', async () => {
  const { engine, client } = setup({}, { sessions: NP, pool: [poster('a')] });
  assert.equal((await engine.decide()).poster.source, 'now-playing');
  assert.equal(client.calls.sessions, 1);
});

// ---- content rating (R-FILT-1, D5): the client-side ladder is the guarantee ----

const rated = (k, contentRating) => ({ ...poster(k), contentRating });
const MIXED = [rated('g', 'G'), rated('pg13', 'PG-13'), rated('r', 'R'), rated('tvma', 'TV-MA'), rated('nc', 'NC-17'), rated('gb15', 'gb/15'), rated('gbxx', 'gb/XX'), rated('blank', ''), poster('missing')];
const playingRated = (contentRating, extra = {}) => [{ type: 'movie', ratingKey: 'np', title: 'Playing', thumb: '/t/np', contentRating, User: { title: 'me' }, Player: { state: 'playing' }, ...extra }];

async function everyPick(engine, rounds = 60) {
  const seen = new Set();
  for (let i = 0; i < rounds; i++) {
    const d = await engine.decide({ force: true });
    seen.add(d.poster.ratingKey);
    engine.shown(d.poster);
  }
  return seen;
}

// A small deterministic generator, so every allowed poster gets picked within a few rounds.
const spread = () => {
  let n = 7;
  return () => ((n = (n * 37 + 11) % 101) / 101);
};

test('with a limit, only posters at or below it are ever picked, even when the server returns everything', async () => {
  const { engine } = setup({ maxContentRating: 'PG-13' }, { pool: MIXED }, spread());
  assert.deepEqual([...(await everyPick(engine))].sort(), ['g', 'pg13']);
});

test('under R the same rung (TV-MA, gb/15) is allowed but NC-17, unmapped and unrated are not', async () => {
  const { engine } = setup({ maxContentRating: 'R' }, { pool: MIXED }, spread());
  assert.deepEqual([...(await everyPick(engine, 120))].sort(), ['g', 'gb15', 'pg13', 'r', 'tvma']);
});

test('under NC-17 every mapped rating is allowed but unrated and unmapped still are not', async () => {
  const { engine } = setup({ maxContentRating: 'NC-17' }, { pool: MIXED }, spread());
  assert.deepEqual([...(await everyPick(engine, 150))].sort(), ['g', 'gb15', 'nc', 'pg13', 'r', 'tvma']);
});

test('with no limit nothing is filtered, unrated included', async () => {
  const { engine } = setup({ maxContentRating: '' }, { pool: MIXED }, spread());
  assert.equal((await everyPick(engine, 200)).size, MIXED.length);
});

test('pool() is asked for the limit and the pool size', async () => {
  const { engine, client } = setup({ maxContentRating: 'PG', randomPoolSize: 77, libraryKey: '1', unwatchedOnly: false }, { pool: MIXED });
  await engine.decide();
  assert.deepEqual(client.calls.poolArgs, [{ libraryKey: '1', unwatchedOnly: false, size: 77, maxContentRating: 'PG' }]);
});

test('the pool cache key includes the limit', async () => {
  const { engine, client, settings } = setup({ maxContentRating: 'PG-13' }, { pool: MIXED });
  await engine.decide({ force: true });
  await engine.decide({ force: true });
  assert.equal(client.calls.pool, 1, 'same limit: cached');
  settings.maxContentRating = 'R';
  const d = await engine.decide({ force: true });
  assert.equal(client.calls.pool, 2, 'new limit: reloaded');
  assert.equal(client.calls.poolArgs[1].maxContentRating, 'R');
  settings.maxContentRating = '';
  await engine.decide({ force: true });
  assert.equal(client.calls.pool, 3);
  assert.ok(d);
});

test('lowering the limit takes effect at once even from a pool loaded under a higher one', async () => {
  const { engine, settings } = setup({ maxContentRating: 'NC-17' }, { pool: MIXED });
  await engine.decide({ force: true });
  settings.maxContentRating = 'G';
  assert.deepEqual([...(await everyPick(engine))], ['g']);
});

test('an empty result throws the empty error with a hint to raise the limit', async () => {
  const { engine } = setup({ maxContentRating: 'G' }, { pool: [rated('r', 'R'), rated('x', '')] });
  await assert.rejects(engine.decide(), (err) => err.kind === 'empty' && /raise the limit/.test(err.message));
});

test('no limit: an empty library keeps the plain empty error', async () => {
  const { engine } = setup({}, { pool: [] });
  await assert.rejects(engine.decide(), (err) => err.kind === 'empty' && !/raise the limit/.test(err.message));
});

test('now playing above the limit is treated as nothing playing: a random allowed poster is shown', async () => {
  const { engine } = setup({ maxContentRating: 'PG-13' }, { sessions: playingRated('R'), pool: MIXED });
  const d = await engine.decide();
  assert.equal(d.poster.source, 'random');
  assert.ok(['g', 'pg13'].includes(d.poster.ratingKey));
});

test('now playing that is unrated, empty or unmapped is nothing playing while a limit is set', async () => {
  for (const sessions of [playingRated(undefined), playingRated(''), playingRated('gb/XX'), playingRated('TV-MA'), playingRated('gb/15')]) {
    const { engine } = setup({ maxContentRating: 'PG-13' }, { sessions, pool: MIXED });
    assert.equal((await engine.decide()).poster.source, 'random', JSON.stringify(sessions[0].contentRating));
  }
});

test('now playing at or below the limit is shown', async () => {
  for (const rating of ['PG-13', 'TV-14', 'G', 'gb/12']) {
    const { engine } = setup({ maxContentRating: 'PG-13' }, { sessions: playingRated(rating), pool: MIXED });
    assert.equal((await engine.decide()).poster.source, 'now-playing', rating);
  }
});

test('limitNowPlaying:false shows any playing title under a limit', async () => {
  for (const rating of ['R', undefined, 'gb/XX']) {
    const { engine } = setup({ maxContentRating: 'PG-13', limitNowPlaying: false }, { sessions: playingRated(rating), pool: MIXED });
    assert.equal((await engine.decide()).poster.source, 'now-playing');
  }
});

test('limitNowPlaying absent or undefined behaves as on: a playing title above the limit is hidden', async () => {
  const cases = [{ limitNowPlaying: undefined }, {}];
  for (const extra of cases) {
    for (const rating of ['R', undefined, 'gb/XX']) {
      const { engine, settings } = setup({ maxContentRating: 'PG-13', ...extra }, { sessions: playingRated(rating), pool: MIXED });
      if (!('limitNowPlaying' in extra)) delete settings.limitNowPlaying; // truly absent, not the default
      assert.equal(settings.limitNowPlaying, undefined);
      assert.equal((await engine.decide()).poster.source, 'random', `${JSON.stringify(extra)} ${rating}`);
    }
  }
});

test('with no limit, limitNowPlaying makes no difference and unrated playback shows', async () => {
  for (const limitNowPlaying of [true, false]) {
    const { engine } = setup({ maxContentRating: '', limitNowPlaying }, { sessions: playingRated(undefined), pool: MIXED });
    assert.equal((await engine.decide()).poster.source, 'now-playing');
  }
});

test('an above-limit episode is hidden by its own rating', async () => {
  const sessions = [{ type: 'episode', ratingKey: 'e1', grandparentRatingKey: 'show', grandparentTitle: 'Show', title: 'Ep', grandparentThumb: '/t/show', contentRating: 'TV-MA', Player: { state: 'playing' } }];
  const { engine } = setup({ maxContentRating: 'PG-13' }, { sessions, pool: MIXED });
  assert.equal((await engine.decide()).poster.source, 'random');
});

test('playing() still reports playback of an above-limit title (sleep mode needs to know)', async () => {
  const { engine } = setup({ maxContentRating: 'G' }, { sessions: playingRated('R'), pool: MIXED });
  assert.equal((await engine.playing())?.ratingKey, 'np');
});

test('an owner-pinned poster is exempt from the limit', async () => {
  const { engine, client } = setup({ maxContentRating: 'G', staticRatingKey: '42' }, { pool: MIXED, itemRating: 'NC-17' });
  const d = await engine.decide();
  assert.equal(d.poster.ratingKey, '42');
  assert.equal(d.poster.contentRating, 'NC-17');
  assert.equal(client.calls.pool, 0);
});

test('a pinned poster still stands in for an above-limit now-playing title', async () => {
  const { engine } = setup({ maxContentRating: 'PG', staticRatingKey: '42' }, { sessions: playingRated('R'), pool: MIXED, itemRating: 'R' });
  const d = await engine.decide();
  assert.equal(d.poster.ratingKey, '42');
  assert.equal(d.poster.source, 'static');
});
