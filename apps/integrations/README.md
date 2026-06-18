# @pyre/integrations

Dedicated backend service (Astro SSR on Vercel) that hosts the Momence webhook and
the transactional email system. Email templates live in `src/emails/`.

## Email assets & caching

Transactional emails reference images by absolute URL through the `ASSET_BASE`
constant (`src/emails/components/assets.ts`), which points at this deployment's
`/email/` directory (the files in `public/email/`). Email clients fetch these
through their own image proxies (Gmail, Apple Mail Privacy Protection, etc.).

**Static email assets must be served with long-lived cache headers.** Vercel's
default for `public/` files is `Cache-Control: public, max-age=0, must-revalidate`,
which forces the client/proxy to re-fetch *every image on every open*. Under that
policy any transient hiccup — a serverless cold start, a brief 5xx, a proxy
timeout, or simply the client hitting its parallel-connection limit while loading
several images at once — silently drops an image, so icons and banners "sometimes"
fail to load.

This is configured in `vercel.json` and **must be kept in place**:

```json
"headers": [
  {
    "source": "/email/(.*)",
    "headers": [
      { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
    ]
  }
]
```

### Rules when working with email images

- **Keep the `/email/(.*)` cache header** in `vercel.json`. Never let email assets
  fall back to the `max-age=0, must-revalidate` default.
- **Version the URL when you replace an asset.** Because the header is `immutable`,
  proxies/caches keep a swapped-out file under the same name. When you change an
  existing image, either rename it or append a cache-buster (e.g.
  `${ASSET_BASE}/logo-header-creme.png?v=2`) so clients fetch the new bytes.
- **Keep assets small.** Large backgrounds (e.g. multi-MB PNGs) hog the client's
  few parallel connections and make smaller requests (badges/icons) more likely to
  be dropped. Compress aggressively and prefer JPG for photographic backgrounds.

## Development

```bash
yarn workspace @pyre/integrations dev     # Astro dev server
yarn workspace @pyre/integrations email   # react-email preview on :3030
```

When previewing locally, `ASSET_BASE` still points at the Vercel production URL, so
newly added/changed images won't appear until deployed. To preview them locally,
set `PUBLIC_EMAIL_ASSET_BASE` to a locally-served `/email` path (e.g.
`http://localhost:4321/email`).
