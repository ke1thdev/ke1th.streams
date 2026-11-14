(() => {
  'use strict';

  function proxyTarget(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const proxy = new URL(value);
      if (proxy.protocol !== 'https:' || proxy.hostname !== 'bx-tv.com' ||
          proxy.pathname !== '/proxy.php' || proxy.port || proxy.username || proxy.password ||
          proxy.searchParams.getAll('url').length !== 1) return null;
      const target = new URL(proxy.searchParams.get('url'));
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
      return target;
    } catch {
      return null;
    }
  }

  function manifestMimeType(url) {
    const target = proxyTarget(url);
    if (!target) return undefined;
    if (/\.m3u8$/i.test(target.pathname)) return 'application/x-mpegurl';
    if (/\.mpd$/i.test(target.pathname)) return 'application/dash+xml';
    return undefined;
  }

  function normalizeSegmentResponse(response) {
    if (!response || !response.headers || typeof response.headers !== 'object') return false;
    const target = proxyTarget(response.originalUri || response.uri);
    if (!target || !/\.(?:ts|tsa|tsv)$/i.test(target.pathname)) return false;

    const headers = response.headers;
    const typeKeys = Object.keys(headers).filter(key => key.toLowerCase() === 'content-type');
    // Preserve an explicit media type, including case variants of the header.
    const genericTypes = ['', 'application/octet-stream', 'binary/octet-stream'];
    if (typeKeys.some(key => typeof headers[key] !== 'string' ||
        !genericTypes.includes(headers[key].split(';', 1)[0].trim().toLowerCase()))) return false;

    // BX-TV's relay hides the .ts extension behind proxy.php. Shaka needs the
    // MPEG-TS type for its HEAD probe as well as the actual media response.
    for (const key of typeKeys) if (key !== 'content-type') delete headers[key];
    headers['content-type'] = 'video/mp2t';
    return true;
  }

  window.LiveStreamSource = { manifestMimeType, normalizeSegmentResponse };
})();
