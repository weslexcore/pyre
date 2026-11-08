// /admin/account: the ways the signed-in person can get back in besides the
// emailed link. A password and any number of passkeys, so a lost or
// unreachable inbox does not lock them out. Reads and writes go through
// /api/auth/account/*, which only ever touch the session's own user.

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { sendJson } from '@/lib/client/api';
import { PasskeyCancelled, passkeysSupported, registerPasskey } from '@/lib/client/webauthn';
import { confirmAction } from './ConfirmDialog';
import { ErrorBanner } from './ErrorBanner';

interface Passkey {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
}

interface Account {
  email: string;
  hasPassword: boolean;
  passkeys: Passkey[];
  passkeysAvailable: boolean;
}

const MIN_LENGTH = 10;

const CARD = 'rounded-lg border border-white/10 bg-white/[0.03] p-4';
const FIELD =
  'w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--pyre-creme)] outline-none transition-colors focus:border-white/30';
const PRIMARY =
  'rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:border-[var(--pyre-red)] disabled:opacity-40';
const QUIET =
  'font-mono text-xs uppercase tracking-wide text-white/50 underline hover:text-white disabled:opacity-40';

function formatDate(iso: string | undefined): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AccountSecurity() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccount(await sendJson<Account>('/api/auth/account', 'GET'));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your sign-in methods');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) return <ErrorBanner>{loadError}</ErrorBanner>;
  if (!account) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  return (
    <div className="max-w-xl space-y-6">
      <p className="text-sm text-white/60">
        You can always sign in with a link sent to{' '}
        <span className="font-mono text-white/80">{account.email}</span>. Add a password or a
        passkey so you can still get in without that inbox.
      </p>
      <PasswordSection hasPassword={account.hasPassword} onSaved={load} />
      <PasskeySection
        passkeys={account.passkeys}
        available={account.passkeysAvailable}
        onChanged={load}
      />
    </div>
  );
}

function PasswordSection({
  hasPassword,
  onSaved,
}: {
  hasPassword: boolean;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN_LENGTH && password === confirm;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/auth/account/password', 'POST', { password });
      setPassword('');
      setConfirm('');
      setOpen(false);
      setSaved(true);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Password</h2>
          <p className="text-xs text-white/50">
            {hasPassword ? 'Set. Sign in with your email and password.' : 'Not set.'}
          </p>
        </div>
        {!open && (
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              setOpen(true);
              setSaved(false);
            }}
          >
            {hasPassword ? 'Change password' : 'Set a password'}
          </button>
        )}
      </div>
      {saved && !open && <p className="mt-3 font-mono text-xs text-white/60">Password saved.</p>}
      {open && (
        <form onSubmit={save} className="mt-4 space-y-3">
          <input
            className={FIELD}
            type="password"
            autoComplete="new-password"
            placeholder={`New password (at least ${MIN_LENGTH} characters)`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="New password"
          />
          <input
            className={FIELD}
            type="password"
            autoComplete="new-password"
            placeholder="Type it again"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-label="Confirm new password"
          />
          {mismatch && <p className="font-mono text-xs text-white/50">The two do not match yet.</p>}
          {error && <ErrorBanner mono>{error}</ErrorBanner>}
          <div className="flex items-center gap-4">
            <button type="submit" className={PRIMARY} disabled={busy || !valid}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
            <button
              type="button"
              className={QUIET}
              onClick={() => {
                setOpen(false);
                setPassword('');
                setConfirm('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function PasskeySection({
  passkeys,
  available,
  onChanged,
}: {
  passkeys: Passkey[];
  available: boolean;
  onChanged: () => Promise<void>;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSupported(passkeysSupported()), []);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      await onChanged();
    } catch (e) {
      if (!(e instanceof PasskeyCancelled)) {
        setError(e instanceof Error ? e.message : 'Could not add the passkey');
      }
    } finally {
      setBusy(false);
    }
  };

  const canAdd = available && supported;

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Passkeys</h2>
          <p className="text-xs text-white/50">
            Sign in with your fingerprint, face, or device PIN. No email needed.
          </p>
        </div>
        {canAdd && (
          <button type="button" className={PRIMARY} disabled={busy} onClick={add}>
            {busy ? 'Waiting…' : 'Add a passkey'}
          </button>
        )}
      </div>
      {!available && (
        <p className="mt-3 font-mono text-xs text-white/40">
          Passkeys only work on integrations.pyresauna.com. Open this page there to add one.
        </p>
      )}
      {available && !supported && (
        <p className="mt-3 font-mono text-xs text-white/40">
          This browser cannot make passkeys. Try an up-to-date Chrome, Safari, Edge or Firefox.
        </p>
      )}
      {error && (
        <ErrorBanner mono className="mt-3">
          {error}
        </ErrorBanner>
      )}
      {passkeys.length > 0 ? (
        <ul className="mt-4 divide-y divide-white/10">
          {passkeys.map((passkey) => (
            <PasskeyRow key={passkey.id} passkey={passkey} onChanged={onChanged} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-white/40">No passkeys yet.</p>
      )}
    </section>
  );
}

function PasskeyRow({ passkey, onChanged }: { passkey: Passkey; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.friendly_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = passkey.friendly_name || 'Passkey';

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/auth/account/passkey', 'PATCH', { id: passkey.id, name: name.trim() });
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename the passkey');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove ${label}?`,
      body: 'You will not be able to sign in with it any more. You can add it again later.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/auth/account/passkey?id=${encodeURIComponent(passkey.id)}`, 'DELETE');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the passkey');
      setBusy(false);
    }
  };

  return (
    <li className="py-3">
      {editing ? (
        <form onSubmit={rename} className="flex items-center gap-3">
          <input
            className={FIELD}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            aria-label="Passkey name"
          />
          <button type="submit" className={PRIMARY} disabled={busy || !name.trim()}>
            Save
          </button>
          <button type="button" className={QUIET} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm">{label}</p>
            <p className="font-mono text-xs text-white/40">
              Added {formatDate(passkey.created_at)} · Last used {formatDate(passkey.last_used_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              className={QUIET}
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Rename
            </button>
            <button type="button" className={QUIET} disabled={busy} onClick={remove}>
              Remove
            </button>
          </div>
        </div>
      )}
      {error && (
        <ErrorBanner mono className="mt-2">
          {error}
        </ErrorBanner>
      )}
    </li>
  );
}
