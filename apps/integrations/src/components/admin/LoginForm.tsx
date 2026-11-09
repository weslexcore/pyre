// The sign-in form on the site root. Three ways in, picked at the top:
//
//   - Email link (the default, and the only one until someone sets up
//     another): an email, then a place to type the 6-digit code from the
//     same email. The code is for the phone whose mail app opens links in a
//     browser with no cookies, or the mail client that follows links before
//     anyone taps them. Clicking the link works too: it lands on
//     /api/auth/callback and comes back signed in.
//   - Password: one set on /admin/account after an email sign-in.
//   - Passkey: one added on /admin/account. No email needed; the browser
//     offers the passkeys it holds for this site. Hidden where passkeys
//     cannot work (preview URLs, browsers without the JSON WebAuthn API).
//
// The last method that worked is remembered on this device. The server
// answers the same way whether or not an address belongs to a team member,
// so the form never says who is on staff.

import { type FormEvent, useEffect, useState } from 'react';
import { sendJson } from '@/lib/client/api';
import { PasskeyCancelled, passkeysSupported, signInWithPasskey } from '@/lib/client/webauthn';

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

type Method = 'email' | 'password' | 'passkey';

const METHOD_LABELS: Record<Method, string> = {
  email: 'Email link',
  password: 'Password',
  passkey: 'Passkey',
};

const METHOD_KEY = 'pyre.login.method';

function rememberedMethod(): Method | null {
  try {
    const value = window.localStorage.getItem(METHOD_KEY);
    return value === 'email' || value === 'password' || value === 'passkey' ? value : null;
  } catch {
    return null;
  }
}

function rememberMethod(method: Method): void {
  try {
    window.localStorage.setItem(METHOD_KEY, method);
  } catch {
    // Private mode or blocked storage: the default is fine next time.
  }
}

interface Props {
  returnUrl: string;
  /** An error code from the callback redirect (see ERROR_COPY). */
  initialError: string | null;
  /** Whether this address can use passkeys at all (lib/auth/methods.ts). */
  passkeysAvailable: boolean;
}

export function LoginForm({ returnUrl, initialError, passkeysAvailable }: Props) {
  const [method, setMethod] = useState<Method>('email');
  const [canPasskey, setCanPasskey] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_COPY[initialError] ?? 'Sign-in failed. Try again.') : null
  );

  // Browser-only checks, after hydration so the server render matches.
  useEffect(() => {
    const supported = passkeysAvailable && passkeysSupported();
    setCanPasskey(supported);
    const remembered = rememberedMethod();
    if (remembered && (remembered !== 'passkey' || supported)) setMethod(remembered);
  }, [passkeysAvailable]);

  const methods: Method[] = canPasskey ? ['email', 'password', 'passkey'] : ['email', 'password'];

  const choose = (next: Method) => {
    setMethod(next);
    setStep('email');
    setCode('');
    setError(null);
  };

  const done = (used: Method, redirectTo: string) => {
    rememberMethod(used);
    window.location.assign(redirectTo);
  };

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
      done('email', redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work');
      setBusy(false);
    }
  };

  const signInWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { redirectTo } = await sendJson<{ redirectTo: string }>('/api/auth/password', 'POST', {
        email: email.trim(),
        password,
        returnUrl,
      });
      done('password', redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setBusy(false);
    }
  };

  const startPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      done('passkey', await signInWithPasskey(returnUrl));
    } catch (e) {
      if (!(e instanceof PasskeyCancelled)) {
        setError(e instanceof Error ? e.message : 'Passkey sign-in failed');
      }
      setBusy(false);
    }
  };

  const switcher = (
    <div
      role="tablist"
      aria-label="Sign-in method"
      className="flex rounded-md border border-white/20 p-0.5 font-mono text-xs uppercase tracking-wide"
    >
      {methods.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={method === m}
          onClick={() => choose(m)}
          className={`flex-1 rounded px-2 py-1.5 transition-colors ${
            method === m ? 'bg-white/15 text-[var(--pyre-creme)]' : 'text-white/50 hover:text-white'
          }`}
        >
          {METHOD_LABELS[m]}
        </button>
      ))}
    </div>
  );

  const errorLine = error && <p className="font-mono text-xs text-[var(--pyre-red)]">{error}</p>;

  const emailField = (
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
  );

  if (method === 'email' && step === 'code') {
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
        {errorLine}
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

  if (method === 'password') {
    return (
      <form onSubmit={signInWithPassword} className="space-y-4">
        {switcher}
        {emailField}
        <input
          className={FIELD}
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
        {errorLine}
        <button type="submit" className={BUTTON} disabled={busy || !email.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className={LINK} onClick={() => choose('email')}>
          Forgot it? Email me a link
        </button>
      </form>
    );
  }

  if (method === 'passkey') {
    return (
      <div className="space-y-4">
        {switcher}
        <p className="text-white/60">
          Use the passkey saved on this device or in your password manager.
        </p>
        {errorLine}
        <button type="button" className={BUTTON} disabled={busy} onClick={startPasskey}>
          {busy ? 'Waiting for passkey…' : 'Sign in with a passkey'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={requestLink} className="space-y-4">
      {switcher}
      <p className="text-white/60">Enter your email and we will send you a sign-in link.</p>
      {emailField}
      {errorLine}
      <button type="submit" className={BUTTON} disabled={busy || !email.trim()}>
        {busy ? 'Sending…' : 'Send sign-in link'}
      </button>
    </form>
  );
}
