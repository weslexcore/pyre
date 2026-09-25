// Shared-secret auth for server-to-server routes: `Authorization: Bearer
// <secret>`. Callers pass the secret itself, read as
// `import.meta.env.X ?? process.env.X`: a computed import.meta.env[name]
// is empty in the bundle, so the lookup has to stay at the call site.

import { timingSafeEqual } from 'node:crypto';
import { json } from './json';

/**
 * Whether the request carries `Bearer <secret>`. A missing secret rejects
 * everything (and logs, under `label`, so a misconfigured deploy is loud).
 */
export function hasBearer(request: Request, secret: string | undefined, label: string): boolean {
  if (!secret) {
    console.error(`[${label}] secret not configured — rejecting all requests`);
    return false;
  }
  const given = Buffer.from(request.headers.get('Authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, 401);
}
