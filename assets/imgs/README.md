# Local images

All channel logos and fixed UI images used by the app are served from this folder. Channels with no verified logo use their existing text initials. Do not replace them with a similarly named station's logo.

- `channels/`: downloaded and verified channel artwork.
- `radio/`: the station logos supplied by the site owner.
- `providers/`: fixed streaming-service icons used in the home page filter.
- `tmdb/`: bundled movie/TV artwork and the XAMPP artwork cache.
- `badges/`: local README badges.
- `asset-sources.json`: source and verification notes for the downloaded logos and fixed assets. Source URLs are provenance, not browser image dependencies.

Text and player icon fonts are bundled separately in `assets/fonts`, with their licenses. SVG UI icons already embedded in the HTML/JS remain self-contained.

## Updating catalog artwork

Run `npm run cache:artwork` with Node 20 or later. This downloads the current discovery rails and updates `assets/js/image-manifest.js`. Include the images and manifest together when uploading the site.

Bundled catalog artwork is served from this folder. New titles use the official TMDB image CDN so artwork works on static GitHub Pages as well as XAMPP and Cloudflare Pages. Failed bundled files retry the original artwork, then an available poster/backdrop alternative. Fixed channel logos, provider icons, and fonts remain local.

The optional `api/images/index.php` (XAMPP) and `functions/api/images.js` (Cloudflare Pages) image-cache endpoints are available for server-side use, but the browser does not depend on them. GitHub Pages does not execute these endpoints.

The full TMDB catalog continually changes and cannot all be pre-downloaded. Successful image CDN responses are cached by the PWA after their first load. Playback provider iframes manage their own images separately.
