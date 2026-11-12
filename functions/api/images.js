// Cloudflare Pages equivalent of api/images/index.php.
// Bundled files are served first; newly discovered artwork is cached at the edge.
const MAX_BYTES = 8 * 1024 * 1024;
const types = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function onRequest({ request, env, waitUntil }) {
  const fail = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  const url = new URL(request.url);
  const size = url.searchParams.get('size');
  const file = url.searchParams.get('file') || '';
  if (!['w200', 'w500', 'w1280'].includes(size) || /\s/.test(file) || !/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(file)) return fail(400);
  const asset = new URL(`/assets/imgs/tmdb/${size}/${file}`, url.origin);
  const bundled = await env.ASSETS.fetch(new Request(asset));
  if (bundled.ok && types.has((bundled.headers.get('Content-Type') || '').split(';')[0])) {
    return new Response(request.method === 'HEAD' ? null : bundled.body, { headers: bundled.headers });
  }
  const key = new Request(new URL(`/api/images/?size=${size}&file=${file}`, url.origin));
  const cache = caches.default;
  const cached = await cache.match(key);
  if (cached) return new Response(request.method === 'HEAD' ? null : cached.body, { headers: cached.headers });
  let upstream;
  try {
    upstream = await fetch(`https://image.tmdb.org/t/p/${size}/${file}`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { return fail(502); }
  if (!upstream.ok) return fail(upstream.status === 404 ? 404 : 502);
  const type = (upstream.headers.get('Content-Type') || '').split(';')[0];
  if (!upstream.body || !types.has(type) || Number(upstream.headers.get('Content-Length')) > MAX_BYTES) return fail(502);
  const chunks = [];
  let length = 0;
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); return fail(502); }
      chunks.push(value);
    }
  } catch { return fail(502); }
  if (length < 100) return fail(502);
  const body = new Blob(chunks);
  const signature = new Uint8Array(await body.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  const isPng = png.every((value, index) => signature[index] === value);
  const webp = String.fromCharCode(...signature.slice(0, 4)) === 'RIFF' && String.fromCharCode(...signature.slice(8, 12)) === 'WEBP';
  if (!((type === 'image/jpeg' && jpeg) || (type === 'image/png' && isPng) || (type === 'image/webp' && webp))) return fail(502);
  const response = new Response(body, { headers: {
    'Content-Type': type, 'Content-Length': String(length),
    'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'
  } });
  waitUntil(cache.put(key, response.clone()).catch(() => {}));
  return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
}
