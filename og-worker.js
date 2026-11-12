export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only intercept requests for media.html or /media
    if (url.pathname === '/media.html' || url.pathname === '/media' || url.pathname === '/media/') {
      const type = url.searchParams.get('type');
      const id = url.searchParams.get('id');

      if ((type === 'movie' || type === 'tv' || type === 'anime') && id) {
        // 1. Fetch the static media.html explicitly from the main site
        const originUrl = `https://stream.ke1th.dev${url.pathname}${url.search}`;
        const response = await fetch(originUrl);
        
        // 2. Fetch the movie/show data from your TMDB proxy
        let tmdbData = null;
        try {
          const tmdbType = type === 'anime' ? 'tv' : type;
          const tmdbUrl = `https://tmdb-proxy.ke1th.dev/3/${tmdbType}/${id}?language=en-US`;
          const tmdbResponse = await fetch(tmdbUrl);
          if (tmdbResponse.ok) {
            tmdbData = await tmdbResponse.json();
          }
        } catch (e) {
          // Ignore errors, we'll just fall back to default tags
        }

        if (tmdbData) {
          const title = tmdbData.title || tmdbData.name || 'ke1th.streams';
          const year = (tmdbData.release_date || tmdbData.first_air_date || '').substring(0, 4);
          const displayTitle = year ? `${title} (${year})` : title;
          const overview = tmdbData.overview || 'Watch this on ke1th.streams';
          const imagePath = tmdbData.backdrop_path || tmdbData.poster_path;
          const imageUrl = imagePath ? `https://image.tmdb.org/t/p/w1280${imagePath}` : 'https://stream.ke1th.dev/assets/imgs/preview.png';

          // 3. Use HTMLRewriter to inject the dynamic meta tags
          const rewriter = new HTMLRewriter()
            .on('title', {
              element(e) {
                e.setInnerContent(`${displayTitle} - ke1th.streams`);
              }
            })
            .on('meta[property="og:title"]', {
              element(e) { e.setAttribute('content', `Watch ${displayTitle} on ke1th.streams`); }
            })
            .on('meta[name="twitter:title"]', {
              element(e) { e.setAttribute('content', `Watch ${displayTitle} on ke1th.streams`); }
            })
            .on('meta[property="og:description"]', {
              element(e) { e.setAttribute('content', overview); }
            })
            .on('meta[name="twitter:description"]', {
              element(e) { e.setAttribute('content', overview); }
            })
            .on('meta[property="og:image"]', {
              element(e) { e.setAttribute('content', imageUrl); }
            })
            .on('meta[name="twitter:image"]', {
              element(e) { e.setAttribute('content', imageUrl); }
            });

          return rewriter.transform(response);
        }
      }
    }

    // For all other requests, just return the normal response
    return fetch(request);
  }
};
