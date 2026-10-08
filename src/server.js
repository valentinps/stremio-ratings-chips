const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { decodeConfig, normalizeConfig, DEFAULTS } = require('./config');
const { getTitleData, fetchBaseMeta, fetchMdblist, fetchAgeRatings } = require('./providers');
const { decorateMeta, buildStream } = require('./format');
const pkg = require('../package.json');

const PORT = Number(process.env.PORT) || 7000;
const CONFIGURE_HTML = path.join(__dirname, '..', 'public', 'configure.html');
// Stremio shows the first *loaded* meta in addon order, so while we're slow the user sees
// plain Cinemeta and the page switches to ours once ready. Past this delay we give up on
// ratings for this request (the lookup keeps running and fills the cache for next time).
const RATINGS_DEADLINE_MS = Number(process.env.RATINGS_DEADLINE_MS) || 4000;

function manifest(cfg) {
  const resources = [{ name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }];
  if (cfg && cfg.streamRow) resources.push({ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] });
  return {
    id: 'community.ratings-chips',
    version: pkg.version,
    name: 'Ratings Chips',
    description: 'Shows Rotten Tomatoes, Metacritic, Letterboxd, Trakt… scores and age ratings on the movie/series page. Must be placed ABOVE Cinemeta in your addon order.',
    types: ['movie', 'series'],
    catalogs: [],
    resources,
    idPrefixes: ['tt'],
    behaviorHints: { configurable: true, configurationRequired: !cfg },
  };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const withDeadline = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms).unref())]);

function logErrors(where, errors) {
  for (const err of errors) console.warn(`[${where}] ${err.message}`);
}

async function handleMeta(cfg, type, id) {
  // Series episodes are requested by the series id, but be lenient with "tt123:1:2".
  const imdbId = id.split(':')[0];
  const [base, data] = await Promise.all([
    fetchBaseMeta(cfg.baseMeta, type, id).catch((err) => {
      console.warn(`[meta] ${err.message}`);
      return null;
    }),
    withDeadline(getTitleData(type, imdbId, cfg), RATINGS_DEADLINE_MS),
  ]);
  // No base meta: return an error so Stremio falls through to the next meta addon.
  if (!base) return { status: 404, body: { err: 'not found' } };
  if (!data) {
    console.warn(`[meta] ratings for ${imdbId} took longer than ${RATINGS_DEADLINE_MS}ms`);
    return { status: 200, body: { meta: base }, cache: 60 };
  }
  logErrors('meta', data.errors);
  return { status: 200, body: { meta: decorateMeta(base, data, cfg) }, cache: data.errors.length ? 300 : 3600 };
}

async function handleStream(cfg, type, id) {
  if (!cfg.streamRow) return { status: 200, body: { streams: [] } };
  const data = await getTitleData(type, id.split(':')[0], cfg);
  logErrors('stream', data.errors);
  const stream = buildStream(data, cfg);
  return { status: 200, body: { streams: stream ? [stream] : [] }, cache: data.errors.length ? 300 : 3600 };
}

// Used by the configure page: validates keys and renders a live preview.
async function handleApi(route, req) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } };
  }
  const cfg = normalizeConfig(body.config || {});
  if (!cfg) return { status: 400, body: { error: 'invalid config' } };

  if (route === 'check') {
    const result = { mdblist: null, tmdb: null };
    const probe = 'tt0073195'; // Jaws
    try {
      const mdb = await fetchMdblist('movie', probe, cfg.mdblistKey);
      result.mdblist = mdb ? { ok: true } : { ok: false, error: 'No data returned' };
    } catch (err) {
      result.mdblist = { ok: false, error: err.message };
    }
    if (cfg.tmdbKey) {
      try {
        await fetchAgeRatings('movie', probe, 578, cfg.tmdbKey);
        result.tmdb = { ok: true };
      } catch (err) {
        result.tmdb = { ok: false, error: err.message };
      }
    }
    return { status: 200, body: result };
  }

  if (route === 'preview') {
    const type = body.type === 'series' ? 'series' : 'movie';
    const id = /^tt\d+$/.test(body.id || '') ? body.id : 'tt7798634';
    const result = await handleMeta(cfg, type, id);
    let stream = null;
    if (cfg.streamRow) stream = (await handleStream(cfg, type, id)).body.streams[0] || null;
    const data = await getTitleData(type, id, cfg);
    return {
      status: result.status,
      body: { ...result.body, stream, errors: data.errors.map((e) => e.message) },
    };
  }
  return { status: 404, body: { error: 'unknown endpoint' } };
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/' ) return send(res, 302, '', { location: '/configure' });
  if (url.pathname === '/health') return send(res, 200, { ok: true, version: pkg.version });
  if (url.pathname === '/manifest.json') return send(res, 200, manifest(null));

  if (req.method === 'POST' && parts[0] === 'api' && parts.length === 2) {
    const result = await handleApi(parts[1], req);
    return send(res, result.status, result.body);
  }

  // /configure or /<config>/configure (the gear icon in Stremio opens the latter).
  if (parts[parts.length - 1] === 'configure' && parts.length <= 2) {
    return send(res, 200, fs.readFileSync(CONFIGURE_HTML, 'utf8'), { 'cache-control': 'no-cache' });
  }

  if (parts.length < 2) return send(res, 404, { err: 'not found' });
  const cfg = decodeConfig(parts[0]);
  if (!cfg) return send(res, 400, { err: 'invalid config in URL' });

  if (parts[1] === 'manifest.json' && parts.length === 2) return send(res, 200, manifest(cfg));

  // /<config>/<resource>/<type>/<id>.json  (an optional /<extra>.json segment is ignored)
  const [, resource, type, rawId] = parts;
  if (!['meta', 'stream'].includes(resource) || !['movie', 'series'].includes(type) || !rawId) {
    return send(res, 404, { err: 'not found' });
  }
  const id = rawId.replace(/\.json$/, '');
  if (!/^tt\d+(:\d+:\d+)?$/.test(id)) return send(res, 404, { err: 'unsupported id' });

  const result = resource === 'meta' ? await handleMeta(cfg, type, id) : await handleStream(cfg, type, id);
  const headers = result.cache ? { 'cache-control': `public, max-age=${result.cache}` } : {};
  return send(res, result.status, result.body, headers);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { err: 'internal error' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Ratings Chips addon v${pkg.version} on http://127.0.0.1:${PORT}/configure`);
  });
}

module.exports = { server, manifest, DEFAULTS };
