// Cron route auth. The QStash schedule forwards `Authorization: Bearer
// ${CRON_SECRET}` via its `Upstash-Forward-Authorization` header; the same
// header works for manual curl testing.

import { hasBearer, unauthorized } from '@/lib/http/bearer';

export function isCronAuthorized(request: Request): boolean {
  return hasBearer(request, import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET, 'Cron');
}

export const unauthorizedResponse = unauthorized;
