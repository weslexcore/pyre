// What an island renders when its API answers 401/403 mid-session: the
// cookie expired under an open tab. The page shell (AdminLayout) gates the
// first load; this is the re-login prompt for everything after it.

/** A 401/403 from an API mid-session: the cookie expired. */
export function isSessionExpired(error: string | null): boolean {
  return !!error && /HTTP 40[13]/.test(error);
}

export function SessionExpired({ returnTo }: { returnTo: string }) {
  return (
    <div className="max-w-md mx-auto text-center py-16 px-4">
      <h2 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
        Session expired
      </h2>
      <p className="text-white/60 mb-6">Log in again to continue.</p>
      <a
        href={`/api/auth/login?returnUrl=${encodeURIComponent(returnTo)}`}
        className="inline-block px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
      >
        Log In
      </a>
    </div>
  );
}
