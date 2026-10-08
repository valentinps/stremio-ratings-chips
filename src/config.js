// User configuration lives in the addon URL as base64url-encoded JSON:
//   https://host/<config>/manifest.json
// That is the standard Stremio way of configuring addons; it means the API keys are part
// of the install URL, so the URL should be treated like a password.

const { SOURCE_IDS } = require('./sources');

const DEFAULT_BASE_META = 'https://v3-cinemeta.strem.io';

const DEFAULTS = Object.freeze({
  mdblistKey: '',
  tmdbKey: '',
  sources: ['imdb', 'tomatoes', 'popcorn', 'metacritic', 'letterboxd', 'trakt'],
  overall: true,               // "⭐ Overall 71" chip (average of the shown scores)
  valueStyle: 'native',        // 'native' (6.9, 3.5, 89%) | 'percent' (69, 70, 89)
  percentSymbol: true,         // show "%" in percent mode / for percent-native sources
  nameStyle: 'short',          // 'full' (Rotten Tomatoes) | 'short' (RT) | 'none'
  markers: 'icons',            // 'icons' (🍅) | 'squares' (🟩🟧🟥) | 'circles' (🟢🟠🔴) | 'none'
  showVotes: false,            // "• 268K" after the score
  showUnavailable: false,      // keep chips for sources with no score ("RT —")
  ageRatings: ['US'],          // ISO-3166 country codes; [] disables age ratings
  ageFlags: true,              // 🇺🇸 PG-13 vs US PG-13
  placement: 'top',            // rows above ('top') or below ('bottom') Genres/Cast/Directors
  chipLinks: 'stay',           // 'stay' (click does nothing) | 'external' (opens the source site
                               // inside Stremio's window: Stremio gives chips no target=_blank)
  sectionTitle: 'Ratings',
  ageSectionTitle: 'Age Rating',
  imdbBadge: true,             // refresh the IMDb badge next to the year with MDBList's value
  description: false,          // also prepend a one-line summary to the description
  streamRow: false,            // also add a ratings entry at the top of the stream list
  baseMeta: DEFAULT_BASE_META, // addon whose metadata is decorated (Cinemeta by default)
});

const ENUMS = {
  valueStyle: ['native', 'percent'],
  nameStyle: ['full', 'short', 'none'],
  markers: ['icons', 'squares', 'circles', 'none'],
  placement: ['top', 'bottom'],
  chipLinks: ['stay', 'external'],
};

function encodeConfig(cfg) {
  return Buffer.from(JSON.stringify(cfg), 'utf8').toString('base64url');
}

function decodeConfig(str) {
  let raw;
  try {
    raw = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return normalizeConfig(raw);
}

// Coerces untrusted input into a valid config; unknown keys are dropped.
function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = { ...DEFAULTS };

  for (const key of ['mdblistKey', 'tmdbKey']) {
    if (typeof raw[key] === 'string') cfg[key] = raw[key].trim().slice(0, 512);
  }
  for (const key of ['sectionTitle', 'ageSectionTitle']) {
    // ':' would be read as an i18next namespace separator by Stremio and get swallowed.
    if (typeof raw[key] === 'string' && raw[key].trim()) cfg[key] = raw[key].replace(/:/g, '').trim().slice(0, 40);
  }
  for (const key of ['overall', 'percentSymbol', 'showVotes', 'showUnavailable', 'ageFlags', 'imdbBadge', 'description', 'streamRow']) {
    if (typeof raw[key] === 'boolean') cfg[key] = raw[key];
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (allowed.includes(raw[key])) cfg[key] = raw[key];
  }
  if (Array.isArray(raw.sources)) {
    cfg.sources = [...new Set(raw.sources.filter((s) => SOURCE_IDS.includes(s)))];
  }
  if (Array.isArray(raw.ageRatings)) {
    cfg.ageRatings = [...new Set(raw.ageRatings
      .filter((c) => typeof c === 'string' && /^[a-z]{2}$/i.test(c.trim()))
      .map((c) => c.trim().toUpperCase()))].slice(0, 5);
  }
  if (typeof raw.baseMeta === 'string' && isSafeBaseUrl(raw.baseMeta)) {
    cfg.baseMeta = raw.baseMeta.trim().replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
  }
  return cfg;
}

// The base meta URL is fetched server-side, so only allow public https hosts.
function isSafeBaseUrl(str) {
  let url;
  try {
    url = new URL(str.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false; // IP literals
  return true;
}

module.exports = { DEFAULTS, DEFAULT_BASE_META, encodeConfig, decodeConfig, normalizeConfig };
