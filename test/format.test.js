const test = require('node:test');
const assert = require('node:assert');
const { normalizeConfig, encodeConfig, decodeConfig } = require('../src/config');
const { decorateMeta, buildStream, buildRatingLinks } = require('../src/format');

// Ratings as documented in the MDBList API example (Jaws).
const data = {
  imdbId: 'tt0073195',
  type: 'movie',
  ids: { imdb: 'tt0073195', trakt: 457, tmdb: 578 },
  ratings: [
    { source: 'imdb', value: 8.1, score: 81, votes: 673852, url: 99 },
    { source: 'metacritic', value: 87, score: 87, votes: 21, url: '/jaws' },
    { source: 'metacriticuser', value: null, score: null, votes: null, url: null },
    { source: 'trakt', value: 78, score: 78, votes: 14033, url: null },
    { source: 'tomatoes', value: 97, score: 97, votes: 102, url: '/m/jaws' },
    { source: 'tmdb', value: 76, score: 76, votes: 10114, url: null },
    { source: 'letterboxd', value: 8, score: 80, votes: 876082, url: '/film/jaws/' },
    { source: 'rogerebert', value: 4, score: null, votes: null, url: 'great-movie-jaws-1975' },
  ],
  ageRatings: { US: 'PG', FR: 'U' },
  errors: [],
};

const baseMeta = {
  id: 'tt0073195', type: 'movie', name: 'Jaws', description: 'Shark.',
  links: [
    { name: '8.0', category: 'imdb', url: 'https://imdb.com/title/tt0073195' },
    { name: 'Jaws', category: 'share', url: 'https://www.strem.io/s/movie/jaws-0073195' },
    { name: 'Horror', category: 'Genres', url: 'stremio:///discover/x' },
  ],
};

const cfg = (over = {}) => normalizeConfig({ mdblistKey: 'k', ...over });

test('config round-trips through the URL encoding and drops junk', () => {
  const c = cfg({ sources: ['tomatoes', 'nope', 'imdb'], ageRatings: ['fr', 'xxx'], baseMeta: 'http://127.0.0.1', sectionTitle: 'A:B' });
  assert.deepStrictEqual(c.sources, ['tomatoes', 'imdb']);
  assert.deepStrictEqual(c.ageRatings, ['FR']);
  assert.strictEqual(c.baseMeta, 'https://v3-cinemeta.strem.io');
  assert.strictEqual(c.sectionTitle, 'AB');
  assert.deepStrictEqual(decodeConfig(encodeConfig(c)), c);
  assert.strictEqual(decodeConfig('!!!'), null);
});

test('default chips: overall first, native values, source icons', () => {
  const names = buildRatingLinks(data, cfg()).map((l) => l.name);
  // imdb 81, tomatoes 97, metacritic 87, letterboxd 80, trakt 78 (popcorn missing) -> avg 85
  assert.deepStrictEqual(names, ['⭐ Overall 85', '🟨 IMDb 8.1', '🍅 RT 97%', 'Ⓜ️ MC 87', '🟢 LB 4', '🔴 Trakt 78%']);
  for (const n of names) assert.ok(!n.includes(':'), 'labels must not contain ":"');
});

test('percent mode, colour markers, votes, unavailable sources', () => {
  const c = cfg({ sources: ['imdb', 'popcorn', 'rogerebert'], valueStyle: 'percent', markers: 'squares',
    nameStyle: 'full', showVotes: true, showUnavailable: true, overall: false, percentSymbol: false });
  const names = buildRatingLinks(data, c).map((l) => l.name);
  assert.deepStrictEqual(names, ['🟩 IMDb 81 • 674K', '⬛ Popcornmeter —', '🟩 Roger Ebert 100']);
});

test('chip links point to the source sites', () => {
  const links = buildRatingLinks(data, cfg({ overall: false }));
  const urls = Object.fromEntries(links.map((l) => [l.name.split(' ')[1], l.url]));
  assert.strictEqual(urls.RT, 'https://www.rottentomatoes.com/m/jaws');
  assert.strictEqual(urls.MC, 'https://www.metacritic.com/movie/jaws');
  assert.strictEqual(urls.LB, 'https://letterboxd.com/film/jaws/');
  assert.strictEqual(urls.Trakt, 'https://trakt.tv/movies/457');
});

test('decorateMeta inserts rows before Genres, refreshes the IMDb badge, does not mutate input', () => {
  const before = JSON.stringify(baseMeta);
  const meta = decorateMeta(baseMeta, data, cfg({ ageRatings: ['US', 'DE'], description: true }));
  assert.strictEqual(JSON.stringify(baseMeta), before);
  assert.strictEqual(meta.imdbRating, '8.1');
  const cats = [...new Set(meta.links.map((l) => l.category))];
  assert.deepStrictEqual(cats, ['imdb', 'Ratings', 'Age Rating', 'share', 'Genres']);
  assert.deepStrictEqual(meta.links.filter((l) => l.category === 'imdb').map((l) => l.name), ['8.1']);
  assert.deepStrictEqual(meta.links.filter((l) => l.category === 'Age Rating').map((l) => l.name), ['🇺🇸 PG']);
  assert.ok(meta.description.startsWith('⭐ Overall 85  ·  🟨 IMDb 8.1'));
  assert.ok(meta.description.endsWith('Shark.'));
});

test('placement bottom appends rows after existing ones', () => {
  const meta = decorateMeta(baseMeta, data, cfg({ placement: 'bottom', imdbBadge: false }));
  const cats = [...new Set(meta.links.map((l) => l.category))];
  assert.deepStrictEqual(cats, ['imdb', 'share', 'Genres', 'Ratings', 'Age Rating']);
});

test('no ratings at all leaves meta usable', () => {
  const empty = { ...data, ratings: [], ageRatings: {} };
  const meta = decorateMeta(baseMeta, empty, cfg());
  assert.deepStrictEqual(meta.links.map((l) => l.category), ['imdb', 'share', 'Genres']);
  assert.strictEqual(buildStream(empty, cfg()), null);
});

test('stream row', () => {
  const s = buildStream(data, cfg({ streamRow: true }));
  assert.strictEqual(s.name, '⭐ 85\nOverall');
  assert.ok(s.description.includes('🍅 RT 97%'));
  assert.ok(s.description.includes('🇺🇸 PG'));
  assert.strictEqual(s.externalUrl, 'https://mdblist.com/movie/tt0073195');
});

test('chip links stay on the page by default, external when configured', () => {
  const ours = (c) => decorateMeta(baseMeta, data, c).links.filter((l) => ['Ratings', 'Age Rating'].includes(l.category));
  for (const l of ours(cfg())) assert.strictEqual(l.url, 'stremio:///detail/movie/tt0073195');
  assert.ok(ours(cfg({ chipLinks: 'external' })).every((l) => l.url.startsWith('https://')));
  // The IMDb badge always keeps its imdb.com link (Stremio opens that one in the browser).
  assert.strictEqual(decorateMeta(baseMeta, data, cfg()).links[0].url, 'https://imdb.com/title/tt0073195');
});
