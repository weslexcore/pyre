// The sign-in form on the site root. Two steps: an email, then — once the
// link is on its way — a place to type the 6-digit code from the same email,
// for the phone whose mail app opens links in a browser with no cookies, or
// the mail client that follows links before anyone taps them. Clicking the
// link works too; it lands on /api/auth/callback and comes back signed in.
//
// The server answers the email step the same way whether or not the address
// belongs to a team member, so the form never says who is on staff.

import { type FormEvent, useState } from 'react';
import { sendJson } from '@/lib/client/api';

const ERROR_COPY: Record<string, string> = {
  link_expired: 'That sign-in link has expired or was already used. Request a new one.',
  invalid_callback: 'That sign-in link was incomplete. Request a new one.',
  auth_failed: 'Sign-in failed. Request a new link.',
};

const FIELD =
  'w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-center text-sm text-[var(--pyre-creme)] placeholder:text-white/30 focus:border-white/50 focus:outline-none';
const BUTTON =
  'w-full rounded-md bg-[var(--pyre-red)] px-6 py-3 font-mono text-sm font-bold uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90 disabled:opacity-50';
const LINK = 'font-mono text-xs uppercase tracking-wide text-white/50 underline hover:text-white';

interface Props {
  returnUrl: string;
  /** An error code from the callback redirect (see ERROR_COPY). */
  initialError: string | null;
}

export function LoginForm({ returnUrl, initialError }: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_COPY[initialError] ?? 'Sign-in failed. Try again.') : null
  );

  const requestLink = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/auth/login', 'POST', { email: email.trim(), returnUrl });
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send a sign-in link');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { redirectTo } = await sendJson<{ redirectTo: string }>('/api/auth/verify', 'POST', {
        email: email.trim(),
        token: code.replace(/\D/g, ''),
      });
      window.location.assign(redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work');
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <form onSubmit={verifyCode} className="space-y-4">
        <p className="text-white/60">
          Check your email. Tap the sign-in link, or enter the 6-digit code from it here.
        </p>
        <p className="font-mono text-xs text-white/40">Sent to {email.trim()}</p>
        <input
          className={`${FIELD} font-mono text-lg tracking-[0.4em]`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Six-digit code"
        />
        {error && <p className="font-mono text-xs text-[var(--pyre-red)]">{error}</p>}
        <button
          type="submit"
          className={BUTTON}
          disabled={busy || code.replace(/\D/g, '').length !== 6}
        >
          {busy ? 'Checking…' : 'Sign in with code'}
        </button>
        <button
          type="button"
          className={LINK}
          onClick={() => {
            setStep('email');
            setCode('');
            setError(null);
          }}
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={requestLink} className="space-y-4">
      <p className="text-white/60">Enter your email and we will send you a sign-in link.</p>
      <input
        className={FIELD}
        type="email"
        autoComplete="email"
        required
        placeholder="you@pyresauna.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email"
      />
      {error && <p className="font-mono text-xs text-[var(--pyre-red)]">{error}</p>}
      <button type="submit" className={BUTTON} disabled={busy || !email.trim()}>
        {busy ? 'Sending…' : 'Send sign-in link'}
      </button>
    </form>
  );
}
