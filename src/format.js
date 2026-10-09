// Turns ratings into Stremio meta `links`. The Stremio detail page renders every link whose
// category isn't `imdb`, `share` or `Writers` as a titled row of clickable chips (the same
// component used for Genres / Cast / Directors), which is how ratings get into the main UI.
// Chip text goes through i18next in Stremio, so labels must not contain ':'.

const { SOURCES } = require('./sources');

const MARKERS = {
  squares: ['🟩', '🟨', '🟥'],
  circles: ['🟢', '🟡', '🔴'],
};

// Normalized 0-100 score. MDBList usually provides `score`, but not for every source
// (e.g. Roger Ebert only has `value` on a 4-star scale).
function scoreOf(rating, src) {
  if (typeof rating.score === 'number') return rating.score;
  if (typeof rating.value !== 'number') return null;
  let scale = src.scale;
  if (rating.source === 'letterboxd' && rating.value > 5) scale = 10;
  return Math.min(100, Math.round((rating.value / scale) * 100));
}

function formatNumber(n, decimals) {
  return n.toFixed(decimals).replace(/\.0+$/, '');
}

function formatValue(score, src, cfg) {
  const pct = cfg.percentSymbol ? '%' : '';
  if (cfg.valueStyle === 'percent') return `${Math.round(score)}${pct}`;
  if (src.percent) return `${Math.round(score)}${pct}`;
  if (src.scale === 100) return String(Math.round(score));
  const native = (score / 100) * src.scale;
  return src.scale === 10 ? native.toFixed(1) : formatNumber(native, 1);
}

function formatVotes(votes) {
  if (typeof votes !== 'number' || votes <= 0) return '';
  if (votes >= 1e6) return `${formatNumber(votes / 1e6, 1)}M`;
  if (votes >= 1e3) return `${formatNumber(votes / 1e3, votes >= 1e4 ? 0 : 1)}K`;
  return String(votes);
}

function marker(score, emoji, cfg) {
  if (cfg.markers === 'none') return '';
  if (cfg.markers === 'icons') return emoji;
  const [good, mid, bad] = MARKERS[cfg.markers];
  return score >= 70 ? good : score >= 50 ? mid : bad;
}

function chipLabel({ emoji, name, short, value, votes, score }, cfg) {
  const parts = [];
  const m = marker(score, emoji, cfg);
  if (m) parts.push(m);
  if (cfg.nameStyle === 'full') parts.push(name);
  else if (cfg.nameStyle === 'short') parts.push(short);
  parts.push(value);
  let label = parts.join(' ');
  if (cfg.showVotes && votes) label += ` • ${votes}`;
  return label;
}

// Builds the list of rating entries (in the user's chosen order) plus an overall average.
function buildEntries(data, cfg) {
  const byId = new Map(data.ratings.map((r) => [r.source, r]));
  const meta = { imdbId: data.imdbId, type: data.type, ids: data.ids || {} };
  const fallbackUrl = `https://mdblist.com/${data.type === 'series' ? 'show' : 'movie'}/${data.imdbId}`;

  const entries = [];
  for (const id of cfg.sources) {
    const src = SOURCES[id];
    const rating = byId.get(id) || { source: id };
    const score = scoreOf(rating, src);
    if (score == null) continue; // sources without a score are never shown
    entries.push({
      id,
      score,
      name: src.name,
      short: src.short,
      emoji: src.emojiFor ? src.emojiFor(score) : src.emoji,
      value: formatValue(score, src, cfg),
      votes: formatVotes(rating.votes),
      url: src.url(rating, meta) || fallbackUrl,
    });
  }

  const scored = entries.filter((e) => e.score != null);
  let overall = null;
  if (cfg.overall && scored.length >= 2) {
    const avg = Math.round(scored.reduce((sum, e) => sum + e.score, 0) / scored.length);
    overall = {
      id: 'overall', score: avg, name: 'Overall', short: 'Overall', emoji: '⭐',
      value: String(avg), votes: '', url: fallbackUrl,
    };
  }
  return { entries, overall };
}

function flag(code) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function buildAgeLinks(data, cfg) {
  const links = [];
  for (const country of cfg.ageRatings) {
    const cert = data.ageRatings[country];
    if (!cert) continue;
    links.push({
      name: `${cfg.ageFlags ? flag(country) : country} ${cert.replace(/:/g, '')}`,
      category: cfg.ageSectionTitle,
      url: `https://www.imdb.com/title/${data.imdbId}/parentalguide`,
    });
  }
  return links;
}

function buildRatingLinks(data, cfg) {
  const { entries, overall } = buildEntries(data, cfg);
  const all = overall ? [overall, ...entries] : entries;
  return all.map((e) => ({ name: chipLabel(e, cfg), category: cfg.sectionTitle, url: e.url }));
}

// Decorates a base meta object (from Cinemeta) with rating/age-rating chips.
function decorateMeta(baseMeta, data, cfg) {
  const meta = { ...baseMeta };
  const ours = [...buildRatingLinks(data, cfg), ...buildAgeLinks(data, cfg)];
  // Copy the links: `baseMeta` comes from the cache and must not be mutated.
  let existing = Array.isArray(meta.links) ? meta.links.map((l) => ({ ...l })) : [];

  if (cfg.imdbBadge) {
    const imdb = data.ratings.find((r) => r.source === 'imdb');
    if (imdb && typeof imdb.value === 'number') {
      const value = imdb.value.toFixed(1);
      meta.imdbRating = value;
      existing = existing.filter((l) => l.category !== 'imdb');
      ours.unshift({ name: value, category: 'imdb', url: `https://imdb.com/title/${data.imdbId}` });
    }
  }

  // Stremio orders link rows by the first appearance of each category.
  meta.links = cfg.placement === 'top' ? [...ours, ...existing] : [...existing, ...ours];
  return meta;
}

// Optional single stream entry shown at the top of the stream list (like the original
// Ratings addon). It opens the MDBList page if clicked.
function buildStream(data, cfg) {
  const { entries, overall } = buildEntries(data, cfg);
  if (!entries.length && !overall) return null;
  const lines = entries.map((e) => chipLabel(e, { ...cfg, nameStyle: cfg.nameStyle === 'none' ? 'short' : cfg.nameStyle }));
  const ages = buildAgeLinks(data, cfg).map((l) => l.name);
  if (ages.length) lines.push(ages.join('  '));
  return {
    name: overall ? `⭐ ${overall.value}\nOverall` : cfg.sectionTitle,
    description: lines.join('\n'),
    title: lines.join('\n'), // older Stremio clients read `title`
    externalUrl: `https://mdblist.com/${data.type === 'series' ? 'show' : 'movie'}/${data.imdbId}`,
  };
}

module.exports = { decorateMeta, buildStream, buildEntries, buildRatingLinks, scoreOf, formatValue, formatVotes };
