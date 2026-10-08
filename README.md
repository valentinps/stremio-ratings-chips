# Ratings Chips – Stremio addon

Shows Rotten Tomatoes, Popcornmeter, Metacritic, Letterboxd, Trakt, TMDB, Roger Ebert, MyAnimeList…
scores and per-country age ratings **on the movie/series detail page**, as a row of chips next to
Genres / Cast / Directors:

```
96 min   2019   6.9 [IMDb]

RATINGS
 ⭐ Overall 71   🟨 IMDb 6.9   🍅 RT 89%   🍿 Popcorn 79%   Ⓜ️ MC 64   🟢 LB 3.5   🔴 Trakt 74%
AGE RATING
 🇺🇸 R   🇫🇷 12
GENRES
 Action   Comedy   Horror
```

## How it works (and what Stremio allows)

Addons cannot inject custom UI, HTML or images into Stremio. What they *can* do is supply the
metadata (`meta`) that the detail page is built from. In stremio-web
(`src/components/MetaPreview/MetaPreview.js`), every entry of `meta.links` whose category is not
`imdb`, `share` or `Writers` is rendered as a titled row of clickable chips. That's the same
component as Genres and Cast. This addon:

1. fetches the normal metadata from Cinemeta (or another meta addon you configure),
2. fetches scores from MDBList and age ratings from TMDB (cached 12 h, shared between users),
3. adds them as extra `links` rows (and optionally refreshes the IMDb badge, prefixes the
   description, or adds a ratings entry at the top of the stream list).

Limits that follow from this:

- **Icons are emoji.** Chips are plain text, and only the IMDb badge gets a real logo (Stremio
  hard-codes it). Clicking a chip opens the source page (via Stremio's external-link warning).
- **The addon must be above Cinemeta.** Stremio requests meta from every addon and shows the first
  one *in install order* that has loaded (stremio-core-web `serialize_meta_details.rs`). Cinemeta is
  installed first and can't be moved in the Stremio UI, but the Stremio API can reorder addons. The
  configure page has a button that does this from your browser (`api.strem.io`
  `addonCollectionGet`/`addonCollectionSet`). If ratings are slow, Stremio briefly shows Cinemeta's
  page and switches when ours arrives.
- If you use another metadata addon (e.g. a TMDB/localized one), set it as the *base metadata URL*
  in Advanced, otherwise whichever is first wins.
- Series show series-level ratings. Episode ratings aren't shown.
- Verified against the stremio-web source (desktop v5 / web). The Android TV and older v4 clients
  have their own UI and may not render custom link rows.

## Run

Requires Node 18+. No dependencies.

```sh
npm start            # http://127.0.0.1:7000/configure  (PORT env var to change)
npm test
```

Stremio only installs addons from **HTTPS** URLs, or from `http://127.0.0.1` on the same machine.
To use it on several devices, host it somewhere with HTTPS (Render, Koyeb, Fly.io, a VPS behind
Caddy, BeamUp…). Env vars: `PORT`, `RATINGS_DEADLINE_MS` (default 4000: after that the plain meta
is returned and the ratings land in the cache for the next view).

## Configure

Open `/configure`, paste your MDBList key (and optionally TMDB key), pick sources/order/format,
then **Install**, then **Install & move above Cinemeta** (log in with your Stremio email/password, or
paste your auth key if you sign in with Google/Facebook). Restart Stremio.

The configuration (including API keys) is base64url JSON in the install URL, like the original
Ratings addon. Treat the URL as a secret.

## API usage

One MDBList request per title per 12 h (plus up to two TMDB requests when age ratings are on).
Only titles you open are looked up, so normal use stays well inside the free MDBList limit.
