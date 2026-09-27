// The admin islands' JSON calls to their /api/admin routes: one error
// reader and one mutation helper, so every island reports a failed call the
// same way. Client-bundle-safe.

/** The route's `{ error }` message, or `HTTP <status>` when it sent none. */
export async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** A failed call, with the status kept so an island can tell a 401 from a 409. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A JSON request that resolves to the parsed response and throws ApiError
 * with the route's message on a non-2xx. The body, when given, is sent as
 * application/json.
 */
export async function sendJson<T>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as T;
}
