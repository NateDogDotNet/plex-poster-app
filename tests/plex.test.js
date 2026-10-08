import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, createPlexClient, discoverServers, pickNowPlaying, rankConnections } from '../js/plex.js';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('buildUrl skips empty params and joins paths', () => {
  const url = buildUrl('http://h:32400', '/library/sections', { a: 1, b: '', c: null, 'X-Plex-Token': 't' });
  assert.equal(url, 'http://h:32400/library/sections?a=1&X-Plex-Token=t');
});

test('pickNowPlaying filters by user and media type, preferring playing sessions', () => {
  const sessions = [
    { type: 'movie', ratingKey: '1', title: 'Paused One', thumb: '/t/1', User: { title: 'Nate' }, Player: { state: 'paused' } },
    { type: 'track', ratingKey: '2', title: 'Song', thumb: '/t/2', User: { title: 'Nate' } },
    { type: 'movie', ratingKey: '3', title: 'Other user', thumb: '/t/3', User: { title: 'Sam' }, Player: { state: 'playing' } },
    { type: 'episode', ratingKey: '4', grandparentRatingKey: '40', grandparentTitle: 'Show', grandparentThumb: '/t/40', title: 'Ep', thumb: '/t/4', User: { title: 'nate' }, Player: { state: 'playing' } },
  ];
  const p = pickNowPlaying(sessions, { username: 'NATE' });
  assert.equal(p.ratingKey, '40');
  assert.equal(p.title, 'Show');
  assert.equal(p.thumb, '/t/40');

  const moviesOnly = pickNowPlaying(sessions, { username: 'nate', includeEpisodes: false });
  assert.equal(moviesOnly.title, 'Paused One');

  assert.equal(pickNowPlaying(sessions, { username: 'nobody' }), null);
  assert.equal(pickNowPlaying(sessions).title, 'Other user');
  assert.equal(pickNowPlaying([]), null);
});

test('client sends token in the query and only an Accept header (no CORS preflight)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: new URL(url), opts });
    return jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: '7', title: 'A', thumb: '/thumb/7', year: 1999 }, { ratingKey: '8', title: 'No art' }] } });
  };
  const client = createPlexClient({ serverUrl: 'http://h:32400/', token: 'tok', clientId: 'cid', fetchImpl });
  const pool = await client.pool({ libraryKey: '1', unwatchedOnly: true, size: 50 });
  assert.deepEqual(pool, [{ ratingKey: '7', title: 'A', year: '1999', thumb: '/thumb/7', source: 'random', user: '' }]);
  const { url, opts } = calls[0];
  assert.equal(url.pathname, '/library/sections/1/all');
  assert.equal(url.searchParams.get('X-Plex-Token'), 'tok');
  assert.equal(url.searchParams.get('unwatched'), '1');
  assert.equal(url.searchParams.get('X-Plex-Container-Size'), '50');
  assert.deepEqual(Object.keys(opts.headers), ['Accept']);
});

test('client maps HTTP failures to typed errors', async () => {
  const client401 = createPlexClient({ serverUrl: 'http://h', token: 'bad', clientId: 'c', fetchImpl: async () => new Response('', { status: 401 }) });
  await assert.rejects(client401.sessions(), { kind: 'auth' });

  const clientDown = createPlexClient({ serverUrl: 'http://h', token: 't', clientId: 'c', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(clientDown.sessions(), { kind: 'network' });

  const client500 = createPlexClient({ serverUrl: 'http://h', token: 't', clientId: 'c', fetchImpl: async () => new Response('', { status: 500 }) });
  await assert.rejects(client500.libraries(), { kind: 'http', status: 500 });
});

test('imageUrl uses the photo transcoder with the requested size', () => {
  const client = createPlexClient({ serverUrl: 'http://h:32400', token: 't', clientId: 'c' });
  const url = new URL(client.imageUrl('/library/metadata/7/thumb/123', { width: 600, height: 900 }));
  assert.equal(url.pathname, '/photo/:/transcode');
  assert.equal(url.searchParams.get('url'), '/library/metadata/7/thumb/123');
  assert.equal(url.searchParams.get('width'), '600');
  assert.equal(url.searchParams.get('X-Plex-Token'), 't');
});

test('rankConnections prefers local, direct, https and can require https', () => {
  const conns = [
    { uri: 'https://relay', relay: true, local: false, protocol: 'https' },
    { uri: 'http://lan', local: true, protocol: 'http' },
    { uri: 'https://lan.plex.direct', local: true, protocol: 'https' },
    { uri: 'https://wan.plex.direct', local: false, protocol: 'https' },
  ];
  assert.deepEqual(rankConnections(conns).map((c) => c.uri), ['https://lan.plex.direct', 'http://lan', 'https://wan.plex.direct', 'https://relay']);
  assert.deepEqual(rankConnections(conns, { secureOnly: true }).map((c) => c.uri), ['https://lan.plex.direct', 'https://wan.plex.direct', 'https://relay']);
});

test('discoverServers keeps only servers with usable connections', async () => {
  const fetchImpl = async () =>
    jsonResponse([
      { name: 'Living room TV', provides: 'player', connections: [{ uri: 'http://tv', protocol: 'http' }] },
      { name: 'Home', provides: 'server', owned: true, accessToken: 'srv', connections: [{ uri: 'http://lan', local: true, protocol: 'http' }] },
    ]);
  const servers = await discoverServers('cid', 'user-token', { fetchImpl });
  assert.equal(servers.length, 1);
  assert.equal(servers[0].accessToken, 'srv');
  assert.deepEqual(await discoverServers('cid', 't', { fetchImpl, secureOnly: true }), []);
});
