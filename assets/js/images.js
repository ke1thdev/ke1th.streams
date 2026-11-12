(() => {
  'use strict';
  const base = new URL('.', document.baseURI);
  const bundled = new Set(window.LOCAL_ARTWORK || []);
  const sizes = new Set(['w200', 'w500', 'w1280']);
  const cdn = 'https://image.tmdb.org/t/p/';
  const imageStates = new WeakMap();
  const backgrounds = new WeakMap();
  const placeholder = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="#1a1a1a"/><path d="M108 206h84v56h-84zM108 249l24-24 18 18 12-12 30 31" fill="none" stroke="#555" stroke-width="3"/><circle cx="169" cy="220" r="5" fill="#555"/><text x="150" y="290" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="12">Artwork unavailable</text></svg>'
  );

  function key(path, size = 'w500') {
    const file = typeof path === 'string' ? path.replace(/^\//, '') : '';
    return sizes.has(size) && /^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(file) && !/\s/.test(file)
      ? `${size}/${file}` : '';
  }
  function validKey(value) {
    const [size, file, extra] = (value || '').split('/');
    return !extra && key(file, size) === value ? value : '';
  }
  function candidates(primary, alternate) {
    const result = [];
    for (const value of [primary, alternate]) {
      if (!validKey(value)) continue;
      if (bundled.has(value)) result.push(new URL(`assets/imgs/tmdb/${value}`, base).href);
      result.push(cdn + value);
    }
    return [...new Set(result)];
  }
  function fromSource(source) {
    try {
      const url = new URL(source, base);
      if (url.origin === 'https://image.tmdb.org') return validKey(url.pathname.replace(/^\/t\/p\//, ''));
      if (url.origin !== base.origin) return '';
      if (/\/api\/images\/?$/.test(url.pathname)) return key(url.searchParams.get('file'), url.searchParams.get('size'));
      const prefix = new URL('assets/imgs/tmdb/', base).pathname;
      return url.pathname.startsWith(prefix) ? validKey(url.pathname.slice(prefix.length)) : '';
    } catch { return ''; }
  }
  function tmdb(path, size = 'w500') {
    const primary = key(path, size);
    // New catalog titles must work on static hosting too. The PHP/Pages image
    // endpoints are optional and must never be a prerequisite for artwork.
    return primary ? candidates(primary)[0] : '';
  }
  function attrs(path, size = 'w500', alternatePath) {
    const primary = key(path, size);
    const alternate = key(alternatePath, size);
    return primary ? `crossorigin="anonymous" data-artwork="${primary}" data-artwork-alternate="${alternate}"` : '';
  }
  function stateFor(image) {
    const primary = validKey(image.dataset.artwork) || fromSource(image.currentSrc || image.src);
    if (!primary) return null; // Local station logos/icons keep their own handling.
    let state = imageStates.get(image);
    if (!state || state.primary !== primary) {
      state = { primary, alternate: validKey(image.dataset.artworkAlternate), tried: new Set(), failed: false };
      imageStates.set(image, state);
    }
    return state;
  }
  function imageError(event) {
    const image = event.target;
    if (image?.tagName !== 'IMG') return;
    if (image.complete === false || (image.currentSrc && image.currentSrc !== image.src)) return;
    const state = stateFor(image);
    if (!state || state.failed) return;
    state.tried.add(image.currentSrc || image.src);
    state.tried.add(image.src);
    const next = candidates(state.primary, state.alternate).find(source => !state.tried.has(source));
    if (next) {
      state.tried.add(next);
      image.dataset.artworkState = 'loading';
      image.src = next;
    } else {
      state.failed = true;
      image.dataset.artworkState = 'unavailable';
      state.onError?.();
      image.src = placeholder;
    }
  }
  function imageLoaded(event) {
    const image = event.target;
    if (image?.tagName !== 'IMG') return;
    const state = stateFor(image);
    if (!state || state.failed) return;
    if (image.currentSrc && image.currentSrc !== image.src) return;
    image.dataset.artworkState = 'loaded';
    state.onLoad?.();
  }
  function setImage(image, path, size = 'w500', options = {}) {
    const primary = key(path, size);
    const alternate = key(options.alternate, size);
    imageStates.set(image, { primary, alternate, tried: new Set(), failed: false,
      onLoad: options.onLoad, onError: options.onError });
    image.dataset.artwork = primary;
    image.dataset.artworkAlternate = alternate;
    image.dataset.artworkState = 'loading';
    image.crossOrigin = 'anonymous';
    if (!primary) {
      imageStates.get(image).failed = true;
      image.dataset.artworkState = 'unavailable';
      options.onError?.();
    }
    image.src = tmdb(path, size) || placeholder;
  }
  function background(element, path, size = 'w1280', alternatePath) {
    const token = {};
    backgrounds.set(element, token);
    const sources = candidates(key(path, size), key(alternatePath, size));
    return new Promise(resolve => {
      function next() {
        if (backgrounds.get(element) !== token) return resolve(false);
        const source = sources.shift();
        if (!source) { element.style.backgroundImage = ''; return resolve(false); }
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          if (backgrounds.get(element) !== token) return resolve(false);
          element.style.backgroundImage = `url("${source}")`;
          resolve(true);
        };
        image.onerror = next;
        image.src = source;
      }
      next();
    });
  }
  document.addEventListener('error', imageError, true);
  document.addEventListener('load', imageLoaded, true);
  window.SiteImages = { tmdb, attrs, setImage, background };
})();
