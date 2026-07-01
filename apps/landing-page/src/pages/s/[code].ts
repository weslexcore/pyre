// Public short-link redirect: /s/<code> → the stored (UTM-tagged) URL.
// Keeps the texted link clean while the destination still carries utm_* params,
// so pyreAttribution() (posthog.astro) can read them on landing.

import { getShortLink, incrementClickCount } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ params, redirect }) => {
  const code = params.code;
  if (!code) return redirect('/', 302);

  const link = await getShortLink(code);
  if (!link?.url) return redirect('/', 302);

  // Defense-in-depth: links are created same-origin, but never redirect to a
  // non-http(s) target.
  let target: URL;
  try {
    target = new URL(link.url);
  } catch {
    return redirect('/', 302);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return redirect('/', 302);
  }

  // Count the click; a Redis hiccup must not break the redirect.
  try {
    await incrementClickCount(code);
  } catch {
    // best-effort
  }

  return redirect(target.toString(), 302);
};
