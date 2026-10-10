// A tiny fake Plex Media Server for demos and browser tests. Implements just the
// endpoints the app uses and returns generated SVG "posters".
//
// Control endpoints (no token needed):
//   POST /__mock/play?ratingKey=3&user=demo&offset=600000&duration=6000000&player=Living%20Room&state=paused
//                                             start a fake session (offset/duration in ms, default 0 and the title's
//                                             runtime; player is Player.title, default "Mock Player"; state default playing)
//   POST /__mock/stop                         end it
//   POST /__mock/rate?ratingKey=4&contentRating=R   re-rate a title from now on ("none" = unrated)
//   POST /__mock/sessions-status?status=403   answer /status/sessions with that HTTP status (200 = normal again)
//   GET  /__mock/stats                        {transcode, other}: image requests vs other Plex requests
//   GET  /__mock/log                          {requests}: every Plex request since the last reset, "path?query" without the token
//   POST /__mock/reset-stats                  zero the counters and clear that log
//   POST /__mock/down  /  POST /__mock/up      simulate the server going offline
//
// The 8 titles carry contentRating G, PG, PG-13, R, TV-MA, gb/12, gb/15 and none (title 8, as an unrated
// Plex item has no attribute), and a runtime (`duration`, ms): item 3 is PG-13, 8,040,000 ms, 1972; the unrated item 8 has no
// runtime either. /library/sections/1/all honours `contentRating=a,b,c` strictly: a title whose
// rating is not in the list, or that has none, is dropped before paging. Other unknown parameters are ignored.

import { createServer } from 'node:http';

export const TOKEN = 'demo-token';

const MOVIES = [
  ['The Grand Marquee', 1954, '#8b1e3f', 'G', 5_400_000],
  ['Midnight Projector', 1961, '#1e4f8b', 'PG', 6_300_000],
  ['Velvet Curtain', 1972, '#5b2a86', 'PG-13', 8_040_000],
  ['Popcorn Skies', 1985, '#b5651d', 'R', 6_900_000],
  ['Neon Matinee', 1993, '#127a6b', 'TV-MA', 7_200_000],
  ['Last Reel', 2004, '#6b6b12', 'gb/12', 5_880_000],
  ['Silver Screen Serenade', 2016, '#3a3a3a', 'gb/15', 9_000_000],
  ['Encore', 2023, '#a12828', undefined, undefined], // unrated, no runtime: no contentRating or duration attribute
].map(([title, year, color, contentRating, duration], i) => ({
  ratingKey: String(i + 1),
  key: `/library/metadata/${i + 1}`,
  type: 'movie',
  title,
  year,
  color,
  ...(contentRating ? { contentRating } : {}),
  ...(duration ? { duration } : {}),
  rating: 9 - i * 0.4,
  thumb: `/library/metadata/${i + 1}/thumb/1700000000`,
}));

export async function startMockPlex({ port = 32401, host = '127.0.0.1' } = {}) {
  const state = { session: null, down: false };
  const stats = { transcode: 0, other: 0 };
  const log = []; // "path?query" of every Plex request, token left out
  const ratings = new Map(); // ratingKey -> contentRating set by /__mock/rate ('' = unrated)
  let sessionsStatus = 200;
  // A title as Plex would send it now: a re-rating applies to every endpoint.
  const current = (m) => {
    if (!m || !ratings.has(m.ratingKey)) return m;
    const rest = { ...m };
    delete rest.contentRating;
    return ratings.get(m.ratingKey) ? { ...rest, contentRating: ratings.get(m.ratingKey) } : rest;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cors = { 'Access-Control-Allow-Origin': '*' };
    const json = (status, body) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.startsWith('/__mock/')) {
      const action = url.pathname.slice(8);
      if (action === 'play') {
        const movie = current(MOVIES.find((m) => m.ratingKey === (url.searchParams.get('ratingKey') || '1')));
        const num = (name, fallback) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : fallback);
        const duration = num('duration', movie?.duration);
        state.session = {
          ...movie,
          ...(duration ? { duration } : {}),
          viewOffset: num('offset', 0),
          User: { title: url.searchParams.get('user') || 'demo' },
          Player: { title: url.searchParams.get('player') || 'Mock Player', state: url.searchParams.get('state') || 'playing' },
        };
      }
      if (action === 'rate') {
        const rating = url.searchParams.get('contentRating') || '';
        ratings.set(url.searchParams.get('ratingKey'), rating === 'none' ? '' : rating);
      }
      if (action === 'sessions-status') sessionsStatus = Number(url.searchParams.get('status') || 200);
      if (action === 'stop') state.session = null;
      if (action === 'down') state.down = true;
      if (action === 'up') state.down = false;
      if (action === 'stats') return json(200, { ...stats });
      if (action === 'log') return json(200, { requests: [...log] });
      if (action === 'reset-stats') {
        stats.transcode = 0;
        stats.other = 0;
        log.length = 0;
        return json(200, { ok: true });
      }
      return json(200, { ok: true, ...state });
    }

    if (state.down) {
      req.socket.destroy();
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': '*' });
      return res.end();
    }
    if (url.searchParams.get('X-Plex-Token') !== TOKEN) return json(401, { error: 'Unauthorized' });
    stats[url.pathname === '/photo/:/transcode' ? 'transcode' : 'other']++;
    const query = new URLSearchParams(url.searchParams);
    query.delete('X-Plex-Token');
    log.push(url.pathname + (query.size ? `?${query}` : ''));

    const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'color'));
    const path = url.pathname;
    if (path === '/') return json(200, { MediaContainer: { friendlyName: 'Mock Plex', version: '1.40.0.0000-mock', machineIdentifier: 'mock' } });
    if (path === '/library/sections') {
      return json(200, { MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'Music', type: 'artist' }] } });
    }
    if (path === '/status/sessions') {
      if (sessionsStatus !== 200) return json(sessionsStatus, { error: `Mock: sessions answer ${sessionsStatus}` });
      return json(200, { MediaContainer: { size: state.session ? 1 : 0, Metadata: state.session ? [strip(state.session)] : [] } });
    }
    if (path === '/library/sections/1/all') {
      const size = Number(url.searchParams.get('X-Plex-Container-Size') || MOVIES.length);
      const wanted = url.searchParams.get('contentRating');
      const allowed = wanted === null ? null : wanted.split(',');
      const items = allowed ? MOVIES.map(current).filter((m) => m.contentRating && allowed.includes(m.contentRating)) : MOVIES.map(current);
      return json(200, { MediaContainer: { Metadata: items.slice(0, size).map(strip) } });
    }
    // One key, or several joined by commas (a batched lookup): the ones that exist, in the order asked. A single
    // unknown key is a 404; unknown keys in a list are just absent.
    const meta = path.match(/^\/library\/metadata\/(\d+(?:,\d+)*)$/);
    if (meta) {
      const found = meta[1].split(',').map((k) => MOVIES.find((x) => x.ratingKey === k)).filter(Boolean);
      return found.length || meta[1].includes(',') ? json(200, { MediaContainer: { Metadata: found.map((m) => strip(current(m))) } }) : json(404, {});
    }
    if (path === '/photo/:/transcode') {
      const thumb = url.searchParams.get('url') || '';
      const m = MOVIES.find((x) => thumb.startsWith(x.key + '/')) || MOVIES[0];
      res.writeHead(200, { ...cors, 'Content-Type': 'image/svg+xml' });
      return res.end(posterSvg(m));
    }
    json(404, { error: 'Not found' });
  });

  await new Promise((r) => server.listen(port, host, r));
  return server;
}

function posterSvg(m) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const words = m.title.split(' ');
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [m.title];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.color}"/><stop offset="1" stop-color="#050505"/></linearGradient></defs>
  <rect width="600" height="900" fill="url(#g)"/>
  <circle cx="300" cy="330" r="150" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="18"/>
  <path d="M260 260 L380 330 L260 400 Z" fill="#fff" fill-opacity=".8"/>
  ${lines.map((l, i) => `<text x="300" y="${640 + i * 70}" font-family="Georgia, serif" font-size="58" font-weight="bold" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('\n  ')}
  <text x="300" y="830" font-family="Georgia, serif" font-size="34" fill="#ddd" text-anchor="middle">${m.year}</text>
</svg>`;
}
