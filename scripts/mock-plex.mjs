// A tiny fake Plex Media Server for demos and browser tests. Implements just the
// endpoints the app uses and returns generated SVG "posters".
//
// Control endpoints (no token needed):
//   POST /__mock/play?ratingKey=3&user=demo   start a fake session
//   POST /__mock/stop                         end it
//   POST /__mock/down  /  POST /__mock/up      simulate the server going offline

import { createServer } from 'node:http';

export const TOKEN = 'demo-token';

const MOVIES = [
  ['The Grand Marquee', 1954, '#8b1e3f'],
  ['Midnight Projector', 1961, '#1e4f8b'],
  ['Velvet Curtain', 1972, '#5b2a86'],
  ['Popcorn Skies', 1985, '#b5651d'],
  ['Neon Matinee', 1993, '#127a6b'],
  ['Last Reel', 2004, '#6b6b12'],
  ['Silver Screen Serenade', 2016, '#3a3a3a'],
  ['Encore', 2023, '#a12828'],
].map(([title, year, color], i) => ({
  ratingKey: String(i + 1),
  key: `/library/metadata/${i + 1}`,
  type: 'movie',
  title,
  year,
  color,
  rating: 9 - i * 0.4,
  thumb: `/library/metadata/${i + 1}/thumb/1700000000`,
}));

export async function startMockPlex({ port = 32401, host = '127.0.0.1' } = {}) {
  const state = { session: null, down: false };

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
        const movie = MOVIES.find((m) => m.ratingKey === (url.searchParams.get('ratingKey') || '1'));
        state.session = { ...movie, User: { title: url.searchParams.get('user') || 'demo' }, Player: { state: 'playing' } };
      }
      if (action === 'stop') state.session = null;
      if (action === 'down') state.down = true;
      if (action === 'up') state.down = false;
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

    const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'color'));
    const path = url.pathname;
    if (path === '/') return json(200, { MediaContainer: { friendlyName: 'Mock Plex', version: '1.40.0.0000-mock', machineIdentifier: 'mock' } });
    if (path === '/library/sections') {
      return json(200, { MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'Music', type: 'artist' }] } });
    }
    if (path === '/status/sessions') {
      return json(200, { MediaContainer: { size: state.session ? 1 : 0, Metadata: state.session ? [strip(state.session)] : [] } });
    }
    if (path === '/library/sections/1/all') {
      const size = Number(url.searchParams.get('X-Plex-Container-Size') || MOVIES.length);
      return json(200, { MediaContainer: { Metadata: MOVIES.slice(0, size).map(strip) } });
    }
    const meta = path.match(/^\/library\/metadata\/(\d+)$/);
    if (meta) {
      const m = MOVIES.find((x) => x.ratingKey === meta[1]);
      return m ? json(200, { MediaContainer: { Metadata: [strip(m)] } }) : json(404, {});
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
