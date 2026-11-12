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

On XAMPP, a new title's artwork is fetched once by `api/images/index.php` and saved to `assets/imgs/tmdb/<size>/`. Keep that directory writable by PHP. PHP cURL must use a valid CA certificate bundle; HTTPS verification stays enabled. A later artwork refresh includes those cached files in the manifest.

On Cloudflare Pages, deploy this repository with Pages Functions enabled. `functions/api/images.js` serves bundled artwork first and caches newly discovered images at the edge. Cloudflare's edge cache does not write files back into this repository. File-based Pages Functions are not supported by GitHub Pages alone.

The full TMDB catalog is continually changing and cannot all be pre-downloaded. Previously unseen titles still require an initial artwork fetch by the site's server. Playback provider iframes manage their own internal images separately.
