import type { APIRoute } from 'astro';

export const prerender = false;

// Only this upstream host may be proxied. Path-based reconstruction already
// scopes requests to Momence, but we re-validate the final URL to be safe and
// avoid turning this into an open proxy.
const UPSTREAM_HOST = 'images.momence.com';

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// Abort a stalled upstream fetch well within Apple Mail's image-load timeout so a
// slow Momence response surfaces as an error we can retry, not a hung connection.
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * Image proxy for Momence session banners. Email clients fetch the banner from
 * our domain instead of images.momence.com, so every image in the email appears
 * to come from us. Momence stays the origin behind the scenes.
 *
 * GET /api/img/h/169530/session-banner/<uuid>.jpeg
 *   -> proxies https://images.momence.com/h/169530/session-banner/<uuid>.jpeg
 */
export const GET: APIRoute = async ({ params }) => {
  const path = params.path;
  if (!path) {
    return new Response('Missing image path', { status: 400 });
  }

  let upstream: URL;
  try {
    upstream = new URL(`https://${UPSTREAM_HOST}/${path}`);
  } catch {
    return new Response('Invalid image path', { status: 400 });
  }

  // Reject anything that resolves away from the allowed host (e.g. a path
  // containing a host override or traversal trickery).
  if (upstream.hostname !== UPSTREAM_HOST) {
    return new Response('Forbidden host', { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: { Accept: 'image/*', 'User-Agent': 'pyre-integrations-img-proxy' },
      signal: controller.signal,
    });
  } catch {
    return new Response('Upstream fetch failed', { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return new Response('Image not found', { status: response.status === 404 ? 404 : 502 });
  }

  const contentType = response.headers.get('Content-Type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return new Response('Not an image', { status: 415 });
  }

  // Buffer the full image so we can send a definite Content-Length. Apple Mail's
  // image loader (ImageIO) is far more reliable with a known length than with a
  // streamed/chunked body, which is what broke the session banner there.
  const body = await response.arrayBuffer();

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Length': String(body.byteLength),
    'Cache-Control': IMMUTABLE_CACHE,
  });
  const etag = response.headers.get('ETag');
  if (etag) headers.set('ETag', etag);
  const lastModified = response.headers.get('Last-Modified');
  if (lastModified) headers.set('Last-Modified', lastModified);

  return new Response(body, { status: 200, headers });
};
