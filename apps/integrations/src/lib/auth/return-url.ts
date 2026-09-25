// Where sign-in may send someone afterwards: local admin paths, or a board's
// form — the one page outside /admin that asks a visitor to sign in. Anything
// else (absolute URLs, protocol-relative //host, other paths) falls back to
// /admin, so the auth routes can't be used as open redirects.

const ALLOWED = /^\/(admin|forms)(\/|\?|$)/;

export function safeReturnUrl(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  return ALLOWED.test(raw) ? raw : '/admin';
}

/** `/path?returnUrl=…&extra…` — the auth pages pass returnUrl along every hop. */
export function withReturnUrl(
  path: string,
  returnUrl: string,
  extra: Record<string, string> = {}
): string {
  const params = new URLSearchParams({ ...extra, returnUrl: safeReturnUrl(returnUrl) });
  return `${path}?${params.toString()}`;
}
