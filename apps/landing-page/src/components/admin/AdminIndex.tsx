import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface AdminLink {
  href: string;
  title: string;
  description: string;
}

const ADMIN_LINKS: AdminLink[] = [
  {
    href: '/admin/webhooks',
    title: 'Webhook Executions',
    description: 'Inspect recent webhook events, payloads, traces, and failures.',
  },
  {
    href: '/admin/mailchimp-tags',
    title: 'Mailchimp Tags',
    description: 'Look up tag IDs for the configured Mailchimp audience.',
  },
];

type GateState = 'checking' | 'ok' | 'unauthenticated' | 'forbidden' | 'error';

export function AdminIndex() {
  const { isAuthenticated, user, loading: authLoading, login } = useAuth();
  const [gate, setGate] = useState<GateState>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !user) {
      setGate('unauthenticated');
      return;
    }

    let cancelled = false;
    setGate('checking');
    fetch('/api/admin/check')
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setGate('unauthenticated');
          return;
        }
        if (res.status === 403) {
          setGate('forbidden');
          return;
        }
        if (!res.ok) {
          setErrorMessage(`Admin check failed (${res.status})`);
          setGate('error');
          return;
        }
        setGate('ok');
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMessage('Network error');
        setGate('error');
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user]);

  if (authLoading || gate === 'checking') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--pyre-red)] border-t-transparent" />
      </div>
    );
  }

  if (gate === 'unauthenticated') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">Sign In</h1>
        <p className="text-white/60 mb-6">Log in to continue.</p>
        <button
          type="button"
          onClick={() => login({ returnUrl: '/admin' })}
          className="px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
        >
          Log In
        </button>
      </div>
    );
  }

  if (gate === 'forbidden') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
          Unauthorized
        </h1>
        <p className="text-white/60">You do not have access to this page.</p>
      </div>
    );
  }

  if (gate === 'error') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <p className="text-[var(--pyre-red)]">{errorMessage ?? 'Something went wrong.'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4">
      <div className="mb-8">
        <h1 className="font-primary-semibold text-2xl text-[var(--pyre-creme)]">Admin</h1>
        <p className="text-xs text-white/40 mt-1">Internal tools for the Pyre team.</p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {ADMIN_LINKS.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="block rounded-lg border border-white/10 bg-white/5 px-4 py-4 hover:border-white/30 hover:bg-white/10 transition-colors"
            >
              <div className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)]">
                {link.title}
              </div>
              <p className="mt-1 text-xs text-white/50">{link.description}</p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
