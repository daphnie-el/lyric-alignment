import { createServer } from 'node:http';
import { PORT, HOST, AUTH_TOKEN } from './config.js';
import { send, HttpError, unauthorized, notFound } from './http.js';
import { getDb } from './db.js';
import { seed } from './seed.js';
import { serveAudio } from './static.js';
import { getIndex } from './routes/index.js';
import { getTrackPayload, postTrack } from './routes/track.js';
import { putAlignment } from './routes/alignment.js';

/**
 * Route table keyed path -> method -> handler, so the router can distinguish an
 * unknown path (404) from a known path with the wrong verb (405, which names
 * the allowed methods). A router that collapsed the two would answer 404 for
 * both, which is a good deal less useful to whoever is calling.
 */
const ROUTES = {
  '/api/v1': { GET: getIndex },
  '/api/v1/track': { GET: getTrackPayload, POST: postTrack },
  '/api/v1/track/alignment': { PUT: putAlignment },
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

function normalizePath(url) {
  const path = new URL(url, 'http://localhost').pathname;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function requireToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(/\s+/);
  if (!header) throw unauthorized('send an Authorization header: `Bearer <token>`; the token is in the README');
  if (!/^bearer$/i.test(scheme || '')) throw unauthorized(`authorization scheme must be Bearer, got "${scheme}"`);
  if (token !== AUTH_TOKEN) throw unauthorized('that bearer token is not the one in the README');
  return token;
}

async function handle(req, res) {
  const path = normalizePath(req.url);
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (path.startsWith('/api/audio/')) {
    return serveAudio(req, res, path.slice('/api/audio/'.length));
  }

  const token = requireToken(req);

  const route = ROUTES[path];
  if (!route) {
    throw notFound(
      path === '/' || path === '/api' || path === '/api/v1/'
        ? 'start at GET /api/v1'
        : `no route for ${path}; GET /api/v1 lists the endpoint paths`
    );
  }

  const handler = route[method];
  if (!handler) {
    const allow = Object.keys(route).join(', ');
    throw new HttpError(
      405,
      { error: 'method_not_allowed', hint: `${path} answers ${allow}, not ${method}` },
      { allow }
    );
  }

  await handler(req, res, { token });
}

const server = createServer((req, res) => {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);

  handle(req, res).catch((err) => {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return send(res, err.status, err.body, err.headers);
    console.error('unhandled:', err);
    send(res, 500, { error: 'internal_error', hint: 'this one is a bug in the fixture, not in your client' });
  });
});

getDb();
if (process.env.SEED_ON_START !== 'false') {
  const result = seed();
  if (!result.skipped) console.log(`seeded ${result.lines} lines`);
}

server.listen(PORT, HOST, () => {
  console.log(`api listening on http://localhost:${server.address().port}  (start at /api/v1)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
