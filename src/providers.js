// Upstream API clients: MDBList (scores), TMDB (age ratings per country) and the base
// meta addon (Cinemeta by default). Results are cached per title and shared between
// users, since the data does not depend on whose API key fetched it.

const { Cache } = require('./cache');

const HOUR = 60 * 60 * 1000;
const RATINGS_TTL = 12 * HOUR;
const MISSING_TTL = 6 * HOUR;
const META_TTL = 6 * HOUR;
const TIMEOUT_MS = 6000;

const cache = new Cache({ max: 5000 });

class UpstreamError extends Error {
  constructor(service, status, message) {
    super(`${service} ${status}: ${message}`);
    this.service = service;
    this.status = status;
  }
}

async function getJson(service, url, headers = {}) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || body.status_message || message;
    } catch { /* not JSON */ }
    throw new UpstreamError(service, res.status, message);
  }
  return res.json();
}

// Stremio types are movie/series; MDBList uses movie/show and TMDB uses movie/tv.
const mdblistType = (type) => (type === 'series' ? 'show' : 'movie');
const tmdbType = (type) => (type === 'series' ? 'tv' : 'movie');

async function fetchMdblist(type, imdbId, apiKey) {
  if (!apiKey) throw new UpstreamError('MDBList', 401, 'missing API key');
  return cache.wrap(`mdb:${type}:${imdbId}`, async () => {
    const url = `https://api.mdblist.com/imdb/${mdblistType(type)}/${encodeURIComponent(imdbId)}?apikey=${encodeURIComponent(apiKey)}`;
    const data = await getJson('MDBList', url);
    if (!data || data.error || !Array.isArray(data.ratings)) return { value: null, ttl: MISSING_TTL };
    return {
      value: {
        ids: data.ids || {},
        ratings: data.ratings,
        certification: data.certification || null,
        country: data.country || null,
      },
      ttl: RATINGS_TTL,
    };
  });
}

// TMDB accepts either a v3 API key (query param) or a v4 read access token (JWT, header).
function tmdbRequest(path, apiKey) {
  const isToken = apiKey.startsWith('eyJ');
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${path}${isToken ? '' : `${sep}api_key=${encodeURIComponent(apiKey)}`}`;
  return getJson('TMDB', url, isToken ? { authorization: `Bearer ${apiKey}` } : {});
}

async function findTmdbId(type, imdbId, apiKey) {
  const data = await tmdbRequest(`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, apiKey);
  const list = data && (type === 'series' ? data.tv_results : data.movie_results);
  return list && list.length ? list[0].id : null;
}

// Returns { US: 'PG-13', FR: 'U', ... } for every country TMDB knows about.
async function fetchAgeRatings(type, imdbId, tmdbId, apiKey) {
  if (!apiKey) return {};
  return cache.wrap(`tmdb:${type}:${imdbId}`, async () => {
    const id = tmdbId || (await findTmdbId(type, imdbId, apiKey));
    if (!id) return { value: {}, ttl: MISSING_TTL };

    const out = {};
    if (type === 'series') {
      const data = await tmdbRequest(`/tv/${id}/content_ratings`, apiKey);
      for (const r of (data && data.results) || []) {
        if (r.rating) out[r.iso_3166_1] = r.rating;
      }
    } else {
      const data = await tmdbRequest(`/movie/${id}/release_dates`, apiKey);
      // Prefer theatrical (3), then digital (4), then whatever has a certification.
      const rank = (t) => ({ 3: 0, 4: 1 }[t] ?? 2);
      for (const country of (data && data.results) || []) {
        const best = (country.release_dates || [])
          .filter((d) => d.certification && d.certification.trim())
          .sort((a, b) => rank(a.type) - rank(b.type))[0];
        if (best) out[country.iso_3166_1] = best.certification.trim();
      }
    }
    return { value: out, ttl: RATINGS_TTL };
  });
}

async function fetchBaseMeta(baseUrl, type, id) {
  return cache.wrap(`meta:${baseUrl}:${type}:${id}`, async () => {
    const data = await getJson('Base meta', `${baseUrl}/meta/${type}/${encodeURIComponent(id)}.json`);
    const meta = data && data.meta;
    return { value: meta || null, ttl: meta ? META_TTL : 0 };
  });
}

// Gathers everything needed to render ratings. Never throws: failures are reported in
// `errors` so the meta response can still be served without ratings.
async function getTitleData(type, imdbId, cfg) {
  const errors = [];
  let mdb = null;
  try {
    mdb = await fetchMdblist(type, imdbId, cfg.mdblistKey);
  } catch (err) {
    errors.push(err);
  }

  let ageRatings = {};
  if (cfg.ageRatings.length) {
    try {
      ageRatings = await fetchAgeRatings(type, imdbId, mdb && mdb.ids.tmdb, cfg.tmdbKey);
    } catch (err) {
      errors.push(err);
    }
    // Without TMDB (or when it has nothing), fall back to MDBList's single certification.
    if (!Object.keys(ageRatings).length && mdb && mdb.certification) {
      ageRatings = { [(mdb.country || 'US').toUpperCase()]: mdb.certification };
    }
  }

  return { imdbId, type, ids: (mdb && mdb.ids) || {}, ratings: (mdb && mdb.ratings) || [], ageRatings, errors };
}

module.exports = { getTitleData, fetchBaseMeta, fetchMdblist, fetchAgeRatings, UpstreamError };
