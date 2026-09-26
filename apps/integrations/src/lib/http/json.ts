// The dependency-free JSON response helpers every API route shares. Kept apart
// from ./route so lib/auth/admin (which ./route imports) can use them too.

export const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Alias kept for the goals/boards routes that grew up with this name. */
export const isUuidParam = isUuid;

/** Postgres unique_violation — a duplicate key on insert or update. */
export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505';
}

/**
 * The response for a failed Supabase call: 409 for a unique violation (with
 * `conflict` as the message, when given), 500 with the driver's message
 * otherwise.
 */
export function dbError(error: { message: string; code?: string }, conflict?: string): Response {
  if (conflict && isUniqueViolation(error)) return json({ error: conflict }, 409);
  return json({ error: error.message }, 500);
}
