const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const ORIGIN = 'https://stream.ke1th.dev';
const LOCAL = ORIGIN + '/assets/imgs/tmdb/w500/poster.jpg';
const API = ORIGIN + '/api/images/?size=w500&file=poster.jpg';
const CDN = 'https://image.tmdb.org/t/p/w500/poster.jpg';
const image = () => new Response(Uint8Array.from([255, 216, 255, 1, 2, 3]), {
  headers: { 'Content-Type': 'image/jpeg' }
});
const html = (status = 200) => new Response('<html>Not an image</html>', {
  status, headers: { 'Content-Type': 'text/html; charset=utf-8' }
});

function harness(options = {}) {
  const events = new Map();
  const entries = new Map();
  const calls = { fetch: [], put: [], delete: [], match: [] };
  const address = request => typeof request === 'string' ? request : request.url;
  const store = {
    async match(request) {
      calls.match.push(address(request));
      if (options.fail === 'match') throw new Error('Cache read failed');
      return entries.get(address(request))?.clone();
    },
    async put(request, response) {
      calls.put.push(address(request));
      if (options.fail === 'put') throw new Error('Storage quota exceeded');
      entries.set(address(request), response.clone());
    },
    async delete(request) {
      calls.delete.push(address(request));
      if (options.fail === 'delete') throw new Error('Cache delete failed');
      return entries.delete(address(request));
    }
  };
  const context = {
    self: {
      location: { origin: ORIGIN },
      registration: { scope: ORIGIN + '/' },
      addEventListener(type, callback) { events.set(type, callback); }
    },
    caches: {
      async open() {
        if (options.fail === 'open') throw new Error('Cache unavailable');
        return store;
      },
      async match(request) { return entries.get(address(request))?.clone(); }
    },
    async fetch(request) {
      calls.fetch.push(address(request));
      const response = options.network ? options.network(request) : image();
      return response.clone();
    },
    URL, Request, Response, Headers
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  return {
    calls,
    entries,
    seed(url, response) { entries.set(url, response); },
    async request(url) {
      let response;
      const pending = [];
      events.get('fetch')({
        request: new Request(url),
        respondWith(value) { response = value; },
        waitUntil(value) { pending.push(value); }
      });
      assert.ok(response, 'the service worker should handle this request');
      const result = await response;
      await Promise.all(pending);
      return result;
    }
  };
}

test('a same-origin artwork URL returning HTML200 is not cached', async () => {
  const h = harness({ network: () => html() });
  const response = await h.request(LOCAL);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/html/);
  assert.equal(h.calls.put.length, 0);
  assert.equal(h.entries.size, 0);
});

test('an image API URL returning HTML200 is not cached', async () => {
  const h = harness({ network: () => html() });
  await h.request(API);
  assert.equal(h.calls.put.length, 0);
  assert.equal(h.entries.size, 0);
});

test('poisoned HTML cache entries are evicted and replaced with real artwork', async () => {
  for (const url of [LOCAL, API, CDN]) {
    const h = harness();
    h.seed(url, html());
    const response = await h.request(url);
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg', url);
    assert.deepEqual(h.calls.delete, [url]);
    assert.deepEqual(h.calls.fetch, [url]);
    assert.equal(h.entries.get(url).headers.get('Content-Type'), 'image/jpeg');
  }
});

test('a valid artwork cache hit does not start a new network fetch', async () => {
  for (const url of [LOCAL, API, CDN]) {
    const h = harness();
    h.seed(url, image());
    const response = await h.request(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(h.calls.fetch.length, 0, url);
    assert.equal(h.calls.put.length, 0);
    assert.equal(h.calls.delete.length, 0);
  }
});

test('site.webmanifest JSON is not mistaken for an invalid image', async () => {
  const h = harness();
  const url = ORIGIN + '/assets/imgs/site.webmanifest';
  h.seed(url, new Response('{"name":"StreamMovies"}', {
    headers: { 'Content-Type': 'application/manifest+json' }
  }));
  const response = await h.request(url);
  assert.deepEqual(await response.json(), { name: 'StreamMovies' });
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.delete.length, 0);
});

test('official TMDB image responses are cached and reused', async () => {
  const h = harness();
  const first = await h.request(CDN);
  assert.equal(first.headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await first.arrayBuffer()).byteLength, 6);
  const second = await h.request(CDN);
  assert.equal((await second.arrayBuffer()).byteLength, 6);
  assert.deepEqual(h.calls.fetch, [CDN]);
  assert.deepEqual(h.calls.put, [CDN]);
});

test('failed artwork responses remain uncached and can be retried', async () => {
  for (const url of [LOCAL, API, CDN]) {
    const h = harness({ network: () => html(404) });
    assert.equal((await h.request(url)).status, 404);
    assert.equal((await h.request(url)).status, 404);
    assert.equal(h.calls.put.length, 0, url);
    assert.equal(h.calls.fetch.length, 2);
  }
});

test('cache storage failures do not hide successful artwork responses', async () => {
  for (const url of [LOCAL, API, CDN]) {
    for (const fail of ['open', 'match', 'put', 'delete']) {
      const h = harness({ fail });
      if (fail === 'delete') h.seed(url, html());
      const response = await h.request(url);
      assert.equal(response.status, 200, `${url}, ${fail}`);
      assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
      assert.equal((await response.arrayBuffer()).byteLength, 6);
    }
  }
});

test('HTML200 from the official image CDN cannot poison its poster cache', async () => {
  const h = harness({ network: () => html() });
  await h.request(CDN);
  assert.equal(h.calls.put.length, 0);
  assert.equal(h.entries.size, 0);
});

test('a lookalike external host is not added to the managed artwork cache', async () => {
  const h = harness();
  const url = 'https://image.tmdb.org.other.test/t/p/w500/poster.jpg';
  assert.equal((await h.request(url)).status, 200);
  assert.equal(h.calls.put.length, 0);
});
