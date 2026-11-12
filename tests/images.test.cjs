const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/images.js'), 'utf8');
const CDN = 'https://image.tmdb.org/t/p/';
const BASE = 'https://example.test/STREAMMOVIES/';

function harness(bundled = [], baseURI = BASE + 'browse.html') {
  const listeners = new Map();
  const instances = [];
  class FakeImage {
    constructor() {
      this.tagName = 'IMG';
      this.dataset = {};
      this.currentSrc = '';
      this.history = [];
      instances.push(this);
    }
    set src(value) {
      this._src = new URL(value, baseURI).href;
      this.history.push(this._src);
    }
    get src() { return this._src || ''; }
  }
  const context = {
    window: { LOCAL_ARTWORK: bundled },
    document: {
      baseURI,
      addEventListener(type, callback) { listeners.set(type, callback); }
    },
    URL,
    Image: FakeImage
  };
  vm.runInNewContext(source, context, { filename: 'images.js' });
  function emit(image, type, captured = true) {
    image.currentSrc = image.src;
    if (captured) listeners.get(type)?.({ target: image });
    image['on' + type]?.();
  }
  return {
    api: context.window.SiteImages,
    image: () => new FakeImage(),
    instances,
    emit,
    captured: (image, type) => listeners.get(type)?.({ target: image })
  };
}

test('unbundled artwork resolves directly to TMDB on static hosting', () => {
  const { api } = harness([], 'https://stream.ke1th.dev/browse.html');
  assert.equal(api.tmdb('/new-poster.jpg'), CDN + 'w500/new-poster.jpg');
  assert.equal(api.tmdb('/new-backdrop.jpg', 'w1280'), CDN + 'w1280/new-backdrop.jpg');
  assert.equal(api.tmdb('/search.png', 'w200'), CDN + 'w200/search.png');
  assert.ok(!api.tmdb('/new-poster.jpg').includes('/api/'));
});

test('bundled artwork is preferred with the correct project subdirectory', () => {
  const { api } = harness(['w500/poster.jpg', 'w1280/backdrop.webp']);
  assert.equal(api.tmdb('/poster.jpg'), BASE + 'assets/imgs/tmdb/w500/poster.jpg');
  assert.equal(api.tmdb('/backdrop.webp', 'w1280'), BASE + 'assets/imgs/tmdb/w1280/backdrop.webp');
  assert.equal(api.tmdb('/poster.jpg', 'w200'), CDN + 'w200/poster.jpg');
});

test('artwork attributes identify the source and its alternate safely', () => {
  const { api } = harness();
  const attrs = api.attrs('/poster.jpg', 'w500', '/backdrop.png');
  assert.match(attrs, /crossorigin="anonymous"/);
  assert.match(attrs, /data-artwork="w500\/poster.jpg"/);
  assert.match(attrs, /data-artwork-alternate="w500\/backdrop.png"/);
  assert.equal(api.attrs('/wrong.jpg', 'original'), '');
});

test('invalid paths and unsupported sizes are rejected', () => {
  const { api } = harness();
  for (const value of [null, undefined, '', '../secret.jpg', '/folder/a.jpg', '/a.jpg?x=1', '/a.jpg\n', '/a.svg', 'https://evil.test/a.jpg']) {
    assert.equal(api.tmdb(value), '', String(value));
  }
  for (const size of ['original', 'w185', '', null, 42]) assert.equal(api.tmdb('/safe.jpg', size), '');
});

test('a missing bundled poster falls back to the same CDN image', () => {
  const h = harness(['w500/poster.jpg']);
  const image = h.image();
  image.dataset.artwork = 'w500/poster.jpg';
  image.src = h.api.tmdb('/poster.jpg');
  h.emit(image, 'error');
  assert.equal(image.src, CDN + 'w500/poster.jpg');
  assert.equal(image.dataset.artworkState, 'loading');
  h.emit(image, 'load');
  assert.equal(image.dataset.artworkState, 'loaded');
});

test('a missing bundled source can be recognized without data attributes', () => {
  const h = harness(['w500/poster.jpg']);
  const image = h.image();
  image.src = BASE + 'assets/imgs/tmdb/w500/poster.jpg';
  h.emit(image, 'error');
  assert.equal(image.src, CDN + 'w500/poster.jpg');
});

test('legacy API artwork failures recover directly to the CDN', () => {
  const h = harness();
  const image = h.image();
  image.src = BASE + 'api/images/?size=w500&file=poster.jpg';
  h.emit(image, 'error');
  assert.equal(image.src, CDN + 'w500/poster.jpg');
});

test('a failed poster uses the known alternate backdrop', () => {
  const h = harness(['w500/backdrop.jpg']);
  const image = h.image();
  image.dataset.artwork = 'w500/poster.jpg';
  image.dataset.artworkAlternate = 'w500/backdrop.jpg';
  image.src = h.api.tmdb('/poster.jpg');
  h.emit(image, 'error');
  assert.equal(image.src, BASE + 'assets/imgs/tmdb/w500/backdrop.jpg');
  h.emit(image, 'error');
  assert.equal(image.src, CDN + 'w500/backdrop.jpg');
});

test('fallback attempts end at a local placeholder without an error loop', () => {
  const h = harness(['w500/poster.jpg', 'w500/backdrop.jpg']);
  const image = h.image();
  let errors = 0;
  let loads = 0;
  h.api.setImage(image, '/poster.jpg', 'w500', {
    alternate: '/backdrop.jpg', onError: () => errors++, onLoad: () => loads++
  });
  for (let i = 0; i < 4; i++) h.emit(image, 'error');
  assert.match(image.src, /^data:image\/svg\+xml/);
  assert.equal(image.dataset.artworkState, 'unavailable');
  assert.equal(errors, 1);
  const count = image.history.length;
  for (let i = 0; i < 5; i++) h.emit(image, 'error');
  h.emit(image, 'load');
  assert.equal(image.history.length, count);
  assert.equal(errors, 1);
  assert.equal(loads, 0, 'a placeholder must not be announced as real artwork');
});

test('station logos and local UI icons are untouched by catalog fallbacks', () => {
  const h = harness();
  for (const file of ['assets/imgs/channels/metv-toons.png', 'assets/imgs/favicon-32x32.png', 'assets/imgs/providers/provider.jpg']) {
    const image = h.image();
    image.src = BASE + file;
    h.emit(image, 'error');
    assert.equal(image.src, BASE + file);
    assert.equal(image.history.length, 1);
    assert.equal(image.dataset.artworkState, undefined);
  }
  const external = h.image();
  external.src = 'https://other.example/logo.jpg';
  h.emit(external, 'error');
  assert.equal(external.src, 'https://other.example/logo.jpg');
});

test('setImage preserves text until a real logo successfully loads', () => {
  const h = harness(['w500/logo.png']);
  const image = h.image();
  const ui = { titleVisible: true, logoVisible: false };
  h.api.setImage(image, '/logo.png', 'w500', {
    onLoad: () => { ui.titleVisible = false; ui.logoVisible = true; },
    onError: () => { ui.titleVisible = true; ui.logoVisible = false; }
  });
  assert.deepEqual(ui, { titleVisible: true, logoVisible: false });
  h.emit(image, 'error');
  assert.deepEqual(ui, { titleVisible: true, logoVisible: false });
  h.emit(image, 'load');
  assert.deepEqual(ui, { titleVisible: false, logoVisible: true });
});

test('setImage final error preserves textual title and hides an unavailable logo', () => {
  const h = harness();
  const image = h.image();
  const ui = { titleVisible: true, logoVisible: false };
  let errors = 0;
  h.api.setImage(image, '/logo.png', 'w500', {
    onLoad: () => { ui.titleVisible = false; ui.logoVisible = true; },
    onError: () => { errors++; ui.titleVisible = true; ui.logoVisible = false; }
  });
  h.emit(image, 'error');
  h.emit(image, 'load');
  assert.deepEqual(ui, { titleVisible: true, logoVisible: false });
  assert.equal(errors, 1);
});

test('setImage invalid input immediately reaches unavailable state', () => {
  const h = harness();
  const image = h.image();
  let errors = 0;
  h.api.setImage(image, '../bad.png', 'w500', { onError: () => errors++ });
  assert.equal(errors, 1);
  assert.match(image.src, /^data:image\/svg\+xml/);
  assert.equal(image.dataset.artworkState, 'unavailable');
});

test('a stale image error cannot skip a newly assigned valid source', () => {
  const h = harness();
  const image = h.image();
  h.api.setImage(image, '/old.png');
  const old = image.src;
  h.api.setImage(image, '/new.png');
  image.currentSrc = old;
  h.captured(image, 'error');
  assert.equal(image.src, CDN + 'w500/new.png');
  assert.equal(image.dataset.artworkState, 'loading');
  h.emit(image, 'load');
  assert.equal(image.dataset.artworkState, 'loaded');
});

test('a stale logo load cannot hide the new textual title', () => {
  const h = harness();
  const image = h.image();
  let loaded = 0;
  h.api.setImage(image, '/old.png');
  const old = image.src;
  h.api.setImage(image, '/new.png', 'w500', { onLoad: () => loaded++ });
  image.currentSrc = old;
  h.captured(image, 'load');
  assert.equal(loaded, 0);
  h.emit(image, 'load');
  assert.equal(loaded, 1);
});

test('identical primary and alternate artwork is not retried repeatedly', () => {
  const h = harness(['w500/poster.jpg']);
  const image = h.image();
  h.api.setImage(image, '/poster.jpg', 'w500', { alternate: '/poster.jpg' });
  h.emit(image, 'error');
  assert.equal(image.src, CDN + 'w500/poster.jpg');
  h.emit(image, 'error');
  assert.match(image.src, /^data:image\/svg\+xml/);
  assert.equal(image.history.length, 3);
});

test('background preload falls back from a missing bundle to the CDN', async () => {
  const h = harness(['w1280/hero.jpg']);
  const element = { style: {} };
  const promise = h.api.background(element, '/hero.jpg');
  assert.equal(h.instances[0].src, BASE + 'assets/imgs/tmdb/w1280/hero.jpg');
  h.emit(h.instances[0], 'error', false);
  assert.equal(h.instances[1].src, CDN + 'w1280/hero.jpg');
  h.emit(h.instances[1], 'load', false);
  assert.equal(await promise, true);
  assert.equal(element.style.backgroundImage, `url("${CDN}w1280/hero.jpg")`);
});

test('background tries alternate artwork and clears an unavailable backdrop', async () => {
  const h = harness();
  const element = { style: { backgroundImage: 'url("old")' } };
  const promise = h.api.background(element, '/hero.jpg', 'w1280', '/poster.jpg');
  h.emit(h.instances[0], 'error', false);
  assert.equal(h.instances[1].src, CDN + 'w1280/poster.jpg');
  h.emit(h.instances[1], 'error', false);
  assert.equal(await promise, false);
  assert.equal(element.style.backgroundImage, '');
  assert.equal(h.instances.length, 2);
});

test('invalid background input clears previous artwork without a network request', async () => {
  const h = harness();
  const element = { style: { backgroundImage: 'url("old")' } };
  assert.equal(await h.api.background(element, '../invalid.jpg'), false);
  assert.equal(element.style.backgroundImage, '');
  assert.equal(h.instances.length, 0);
});

test('a late old background load never replaces the newer title backdrop', async () => {
  const h = harness();
  const element = { style: {} };
  const first = h.api.background(element, '/first.jpg');
  const second = h.api.background(element, '/second.jpg');
  h.emit(h.instances[1], 'load', false);
  h.emit(h.instances[0], 'load', false);
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(element.style.backgroundImage, `url("${CDN}w1280/second.jpg")`);
});

test('a stale background error does not request old fallbacks', async () => {
  const h = harness(['w1280/first.jpg']);
  const element = { style: {} };
  const first = h.api.background(element, '/first.jpg');
  const second = h.api.background(element, '/second.jpg');
  h.emit(h.instances[0], 'error', false);
  assert.equal(h.instances.length, 2);
  h.emit(h.instances[1], 'load', false);
  assert.equal(await first, false);
  assert.equal(await second, true);
});
