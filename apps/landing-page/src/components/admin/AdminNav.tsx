import { useAuth } from '@/hooks/useAuth';

/**
 * Slim navigation shown in the admin header (minimal navbar).
 * Provides a link back to the admin home and a Pyre-session-only logout.
 */
export function AdminNav() {
  const { logout } = useAuth();

  return (
    <div className="flex items-center gap-4">
      <a
        href="/admin"
        className="font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-creme)] hover:opacity-70 transition-opacity"
      >
        Admin Home
      </a>
      <button
        type="button"
        onClick={() => logout({ returnUrl: '/admin' })}
        className="rounded-md border border-white/20 px-3 py-1.5 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-creme)] hover:border-white/40 hover:bg-white/10 transition-colors"
      >
        Log Out
      </button>
    </div>
  );
}
