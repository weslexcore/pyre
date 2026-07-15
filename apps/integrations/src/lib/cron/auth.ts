// Cron route auth. Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}`
// to cron paths when the CRON_SECRET env var is set on the project; the same
// header works for manual curl testing.

export function isCronAuthorized(request: Request): boolean {
  const secret = import.meta.env.CRON_SECRET;
  if (!secret) {
    console.error('[Cron] CRON_SECRET not configured — rejecting all cron requests');
    return false;
  }
  return request.headers.get('Authorization') === `Bearer ${secret}`;
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
