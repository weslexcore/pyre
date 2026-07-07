// Public short-link redirect: /s/<code> → the stored (UTM-tagged) URL.
// Keeps the texted link clean while the destination still carries utm_* params.
// Same-site targets get a fast 302 (the destination page runs PostHog itself,
// and pyreAttribution() in posthog.astro reads the utm_* params on landing).
// External targets get a tiny interstitial that captures a `short_link_redirect`
// PostHog event before JS-redirecting — otherwise the click would be invisible
// to analytics, since the visitor never lands on a page we instrument.

import { getShortLink, incrementClickCount } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';

export const prerender = false;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// JSON.stringify does NOT escape "<", so a URL containing "</script>" could
// break out of the inline script block without this.
function jsString(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

// Same array.js stub + init config as posthog.astro (keep the two in sync),
// minus pageview/autocapture/recording: this page exists for well under a
// second, and `short_link_redirect` is the one event it should emit.
function renderInterstitial(code: string, target: URL): string {
  const dest = target.toString();
  const props: Record<string, string> = {
    code,
    destination: dest,
    destination_host: target.hostname,
  };
  for (const key of UTM_KEYS) {
    const value = target.searchParams.get(key);
    if (value) props[key] = value;
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirecting…</title>
<noscript><meta http-equiv="refresh" content="0;url=${escapeHtml(dest)}"></noscript>
</head><body style="font-family:system-ui,sans-serif;background:#161616;color:#efe9df;display:grid;place-items:center;min-height:100vh;margin:0">
<p>Sending you to <a style="color:inherit" href="${escapeHtml(dest)}">${escapeHtml(target.hostname)}</a>…</p>
<script>
(function () {
  var dest = ${jsString(dest)};
  var props = ${jsString(props)};
  var done = false;
  function go() { if (done) return; done = true; window.location.replace(dest); }

  // Same prod gating as posthog.astro: never capture from previews/localhost.
  var PROD_HOSTS = ['pyresauna.com', 'www.pyresauna.com'];
  if (PROD_HOSTS.indexOf(window.location.hostname) === -1) { go(); return; }

  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group identify setPersonProperties setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroups onFeatureFlags addFeatureFlagsHandler onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  posthog.init('phc_cf7IIASrdCARsq3ft7wcOVJqBBiE6SZCPoKqoxxoop6', {
    api_host: 'https://connect.pyresauna.com',
    defaults: '2026-01-30',
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    loaded: function (ph) {
      // Capture only once the real library is loaded — a capture queued on the
      // stub would be lost when the page unloads. sendBeacon survives the
      // navigation, so we can redirect immediately after.
      ph.capture('short_link_redirect', props, { transport: 'sendBeacon', send_instantly: true });
      go();
    }
  });

  // Never strand the visitor if array.js is blocked or slow; the Redis click
  // counter already recorded server-side.
  setTimeout(go, 1500);
})();
</script>
</body></html>`;
}

// Treat www.example.com and example.com as the same site so a www/apex
// mismatch doesn't needlessly route on-site links through the interstitial.
function normalizeHost(host: string): string {
  return host.replace(/^www\./, '').toLowerCase();
}

export const GET: APIRoute = async ({ params, redirect, url }) => {
  const code = params.code;
  if (!code) return redirect('/', 302);

  const link = await getShortLink(code);
  if (!link?.url) return redirect('/', 302);

  // Defense-in-depth: creation validates this too, but never redirect to a
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

  // Pass query params on the short URL itself through to the destination —
  // tracked links to external sites carry utm_* visibly (/s/<code>?utm_…), so
  // params can change per channel without minting a new code. Request params
  // override any baked into the stored URL.
  url.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  // Count the click; a Redis hiccup must not break the redirect.
  try {
    await incrementClickCount(code);
  } catch {
    // best-effort
  }

  if (normalizeHost(target.hostname) === normalizeHost(url.hostname)) {
    return redirect(target.toString(), 302);
  }

  return new Response(renderInterstitial(code, target), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Never cache: the stored URL can change/be deleted, and clicks must count.
      'Cache-Control': 'no-store',
      // Keep short-link codes and our host out of external referrer logs.
      'Referrer-Policy': 'no-referrer',
    },
  });
};
