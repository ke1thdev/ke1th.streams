const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {}, URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/live-source.js'), 'utf8'), context);
const { manifestMimeType, normalizeSegmentResponse } = context.window.LiveStreamSource;
const wrap = target => 'https://bx-tv.com/proxy.php?url=' + encodeURIComponent(target);
const ts = 'https://cdn.example.test/live/video-012.ts?session=abc';
const response = (target = ts, type = 'application/octet-stream') => ({
  uri: wrap(target),
  headers: { 'content-type': type, 'content-length': '0' },
  data: new ArrayBuffer(0)
});

test('wrapped HLS uses a canonical lowercase manifest type despite the PHP path', () => {
  assert.equal(manifestMimeType(wrap('https://jmp2.uk/channel.m3u8')), 'application/x-mpegurl');
  assert.equal(manifestMimeType(wrap('https://cdn.example.test/LIVE.M3U8?token=abc')), 'application/x-mpegurl');
});

test('wrapped DASH manifests are identified without treating other media as manifests', () => {
  assert.equal(manifestMimeType(wrap('https://cdn.example.test/live.mpd?session=x')), 'application/dash+xml');
  assert.equal(manifestMimeType(wrap(ts)), undefined);
  assert.equal(manifestMimeType(wrap('https://cdn.example.test/video.mp4?fake=master.m3u8')), undefined);
});

test('manifest detection is limited to the exact secure BX-TV proxy endpoint', () => {
  const source = encodeURIComponent('https://cdn.example.test/live.m3u8');
  for (const url of [
    'http://bx-tv.com/proxy.php?url=' + source,
    'https://bx-tv.com:8443/proxy.php?url=' + source,
    'https://bx-tv.com.evil.test/proxy.php?url=' + source,
    'https://www.bx-tv.com/proxy.php?url=' + source,
    'https://bx-tv.com/other.php?url=' + source,
    'https://name:password@bx-tv.com/proxy.php?url=' + source,
    'https://cdn.example.test/live.m3u8'
  ]) assert.equal(manifestMimeType(url), undefined, url);
});

test('malformed, missing, ambiguous, and non-HTTP targets are skipped', () => {
  for (const url of [undefined, null, '', {}, 'not a URL',
    'https://bx-tv.com/proxy.php', wrap('/relative/master.m3u8'),
    wrap('data:video/mp2t,video.m3u8'),
    wrap('https://cdn.example.test/live.m3u8') + '&url=https://cdn.example.test/key.key'
  ]) assert.equal(manifestMimeType(url), undefined);
});

test('a TS HEAD response gets its media type without needing a response body', () => {
  const head = response();
  const body = head.data;
  assert.equal(normalizeSegmentResponse(head), true);
  assert.equal(head.headers['content-type'], 'video/mp2t');
  assert.equal(head.headers['content-length'], '0');
  assert.equal(head.data, body);
});

test('both audio and video transport streams use the MPEG-TS type', () => {
  for (const suffix of ['.ts', '.tsa', '.tsv', '.TS']) {
    const media = response('https://cdn.example.test/audio' + suffix);
    assert.equal(normalizeSegmentResponse(media), true);
    assert.equal(media.headers['content-type'], 'video/mp2t');
  }
});

test('generic media types are recognized with case differences and charset parameters', () => {
  for (const type of ['Application/Octet-Stream; charset=UTF-8', ' BINARY/OCTET-STREAM ', '']) {
    const media = response(ts, type);
    assert.equal(normalizeSegmentResponse(media), true);
    assert.equal(media.headers['content-type'], 'video/mp2t');
  }
});

test('case variants of the content-type header become one canonical header', () => {
  const media = { uri: wrap(ts), headers: { 'Content-Type': 'APPLICATION/OCTET-STREAM', 'x-test': 'kept' } };
  assert.equal(normalizeSegmentResponse(media), true);
  assert.deepEqual(media.headers, { 'content-type': 'video/mp2t', 'x-test': 'kept' });
});

test('an absent media type is filled only for a recognized wrapped transport stream', () => {
  const media = { uri: wrap(ts), headers: { 'x-test': 'kept' } };
  assert.equal(normalizeSegmentResponse(media), true);
  assert.equal(media.headers['content-type'], 'video/mp2t');
});

test('originalUri identifies the proxy even if the final response URI changed', () => {
  const media = { originalUri: wrap(ts), uri: ts, headers: { 'content-type': 'application/octet-stream' } };
  assert.equal(normalizeSegmentResponse(media), true);
  assert.equal(media.headers['content-type'], 'video/mp2t');
});

test('an unrelated original URI cannot be overridden by a proxy-looking final URI', () => {
  const media = { originalUri: ts, uri: wrap(ts), headers: { 'content-type': 'application/octet-stream' } };
  assert.equal(normalizeSegmentResponse(media), false);
  assert.equal(media.headers['content-type'], 'application/octet-stream');
});

test('existing explicit media types are preserved', () => {
  for (const type of ['video/mp2t', 'video/mp2t; charset=UTF-8', 'video/mp4', 'audio/mp4', 'text/html']) {
    const media = response(ts, type);
    assert.equal(normalizeSegmentResponse(media), false);
    assert.equal(media.headers['content-type'], type);
  }
});

test('a conflicting explicit header prevents correction of generic aliases', () => {
  const media = response();
  media.headers['Content-Type'] = 'video/mp4';
  assert.equal(normalizeSegmentResponse(media), false);
  assert.equal(media.headers['content-type'], 'application/octet-stream');
  assert.equal(media.headers['Content-Type'], 'video/mp4');
});

test('key files, MP4 media, and playlists remain untouched', () => {
  for (const suffix of ['.key', '.mp4', '.m4s', '.m3u8', '.mpd']) {
    const media = response('https://cdn.example.test/asset' + suffix);
    assert.equal(normalizeSegmentResponse(media), false);
    assert.equal(media.headers['content-type'], 'application/octet-stream');
  }
});

test('direct streams and unrelated proxy hosts remain untouched', () => {
  for (const uri of [ts, wrap(ts).replace('bx-tv.com', 'other.example.test'),
    wrap(ts).replace('/proxy.php', '/other.php'), wrap(ts).replace('https:', 'http:')]) {
    const media = { uri, headers: { 'content-type': 'application/octet-stream' } };
    assert.equal(normalizeSegmentResponse(media), false);
    assert.equal(media.headers['content-type'], 'application/octet-stream');
  }
});

test('invalid response shapes and URLs are ignored', () => {
  for (const media of [undefined, null, {}, { uri: wrap(ts) }, { uri: wrap(ts), headers: null },
    { uri: 'bad URL', headers: {} }, { uri: wrap('/relative/file.ts'), headers: {} },
    { uri: wrap('data:video/mp2t,file.ts'), headers: {} },
    { uri: wrap(ts), headers: { 'content-type': null } }]) {
    assert.equal(normalizeSegmentResponse(media), false);
  }
});
