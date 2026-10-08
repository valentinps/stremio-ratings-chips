// Rating sources returned by the MDBList API (`ratings[].source`).
//
// `scale`  – native maximum, used to render "native" values (6.9, 3.5, 89%).
// `emoji`  – Stremio link chips are plain text, so emoji are the only "icons" available.
// `url`    – builds a link to the source page; chips without a valid http(s) URL are
//            dropped by Stremio, so every source falls back to the MDBList page.

const SOURCES = {
  imdb: {
    name: 'IMDb', short: 'IMDb', emoji: '🟨', scale: 10,
    url: (r, m) => `https://www.imdb.com/title/${m.imdbId}/`,
  },
  tomatoes: {
    name: 'Rotten Tomatoes', short: 'RT', emoji: '🍅', scale: 100, percent: true,
    // Rotten (< 60) gets the splat instead of the tomato, like on the RT website.
    emojiFor: (score) => (score != null && score < 60 ? '🤢' : '🍅'),
    url: (r) => (r.url ? `https://www.rottentomatoes.com${r.url}` : null),
  },
  popcorn: {
    name: 'Popcornmeter', short: 'Popcorn', emoji: '🍿', scale: 100, percent: true,
    url: (r) => (r.url ? `https://www.rottentomatoes.com${r.url}` : null),
  },
  metacritic: {
    name: 'Metacritic', short: 'MC', emoji: 'Ⓜ️', scale: 100,
    url: (r, m) => (r.url ? `https://www.metacritic.com/${m.type === 'series' ? 'tv' : 'movie'}${r.url}` : null),
  },
  metacriticuser: {
    name: 'Metacritic User', short: 'MC User', emoji: '👥', scale: 10,
    url: (r, m) => (r.url ? `https://www.metacritic.com/${m.type === 'series' ? 'tv' : 'movie'}${r.url}` : null),
  },
  letterboxd: {
    name: 'Letterboxd', short: 'LB', emoji: '🟢', scale: 5,
    url: (r) => (r.url ? `https://letterboxd.com${r.url}` : null),
  },
  trakt: {
    name: 'Trakt', short: 'Trakt', emoji: '🔴', scale: 100, percent: true,
    url: (r, m) => (m.ids.trakt ? `https://trakt.tv/${m.type === 'series' ? 'shows' : 'movies'}/${m.ids.trakt}` : null),
  },
  tmdb: {
    name: 'TMDB', short: 'TMDB', emoji: '🎬', scale: 100, percent: true,
    url: (r, m) => (m.ids.tmdb ? `https://www.themoviedb.org/${m.type === 'series' ? 'tv' : 'movie'}/${m.ids.tmdb}` : null),
  },
  rogerebert: {
    name: 'Roger Ebert', short: 'Ebert', emoji: '👍', scale: 4,
    url: (r) => (r.url ? `https://www.rogerebert.com/reviews/${String(r.url).replace(/^\//, '')}` : null),
  },
  myanimelist: {
    name: 'MyAnimeList', short: 'MAL', emoji: '📘', scale: 10,
    url: (r, m) => (m.ids.mal ? `https://myanimelist.net/anime/${m.ids.mal}` : null),
  },
  mdblist: {
    name: 'MDBList', short: 'MDBList', emoji: '📊', scale: 100,
    url: () => null,
  },
};

const SOURCE_IDS = Object.keys(SOURCES);

module.exports = { SOURCES, SOURCE_IDS };
