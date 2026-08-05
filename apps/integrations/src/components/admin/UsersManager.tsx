// Dashboard access manager for /admin/users: add people by their Momence
// login email, toggle admin, pick which pages non-admins can view, revoke.
// The API enforces the real guards (admin-only, last-admin/self protection);
// this island just mirrors them in the UI.
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_TOOLS, SCHEDULE_MANAGE } from './adminTools';

interface DashboardUser {
  id: string;
  email: string;
  is_admin: boolean;
  pages: string[];
  display_name: string | null;
  added_by: string | null;
  created_at: string;
}

interface EnvUser {
  email: string;
  isAdmin: boolean;
  pages: string[];
}

interface UsersResponse {
  users: DashboardUser[];
  envUsers: EnvUser[];
  envActive: boolean;
  self: string;
  source: 'db' | 'env';
}

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function PagePicker({
  pages,
  disabled,
  onChange,
}: {
  pages: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const toggle = (key: string, granted: boolean) => {
    let next = granted ? [...pages, key] : pages.filter((p) => p !== key);
    // Dropping the schedule page drops its manage capability with it.
    if (key === '/admin/schedule' && !granted) next = next.filter((p) => p !== SCHEDULE_MANAGE);
    onChange([...new Set(next)]);
  };

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {ADMIN_TOOLS.map((tool) => (
        <span key={tool.href} className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              type="checkbox"
              checked={pages.includes(tool.href)}
              disabled={disabled}
              onChange={(e) => toggle(tool.href, e.target.checked)}
            />
            {tool.navLabel}
          </label>
          {tool.href === '/admin/schedule' && pages.includes('/admin/schedule') && (
            <label
              className="flex items-center gap-1.5 font-mono text-xs text-[var(--pyre-gold)]"
              title="Edit shifts and the roster, sync Momence, review AI drafts, and manage everyone's time off. Without it: view the schedule and manage own blackout dates only."
            >
              <input
                type="checkbox"
                checked={pages.includes(SCHEDULE_MANAGE)}
                disabled={disabled}
                onChange={(e) => toggle(SCHEDULE_MANAGE, e.target.checked)}
              />
              manage
            </label>
          )}
        </span>
      ))}
    </div>
  );
}

export function UsersManager() {
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [envUsers, setEnvUsers] = useState<EnvUser[]>([]);
  const [envActive, setEnvActive] = useState(false);
  const [self, setSelf] = useState('');
  const [source, setSource] = useState<'db' | 'env'>('db');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  // Employee default: view the schedule, manage their own blackout dates.
  const [newPages, setNewPages] = useState<string[]>(['/admin/schedule']);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as UsersResponse;
      setUsers(body.users);
      setEnvUsers(body.envUsers);
      setEnvActive(body.envActive);
      setSelf(body.self);
      setSource(body.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (id: string, fields: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) setError(await readError(res));
    await load();
    setBusy(false);
  };

  const revoke = async (user: DashboardUser) => {
    if (!window.confirm(`Revoke all dashboard access for ${user.email}?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) setError(await readError(res));
    await load();
    setBusy(false);
  };

  const importEnvUser = async (envUser: EnvUser) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: envUser.email,
        isAdmin: envUser.isAdmin,
        pages: envUser.pages,
      }),
    });
    if (!res.ok) setError(await readError(res));
    else setNotice(`Imported ${envUser.email} — they're now managed from this page.`);
    await load();
    setBusy(false);
  };

  const addUser = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail.trim(), isAdmin: newIsAdmin, pages: newPages }),
    });
    if (!res.ok) {
      setError(await readError(res));
    } else {
      const body = (await res.json()) as { user: DashboardUser; momenceMatch: boolean };
      setNotice(
        body.momenceMatch
          ? `Added ${body.user.email}${body.user.display_name ? ` (${body.user.display_name})` : ''}.`
          : `Added ${body.user.email} — no Momence member matched this email. They can only log in if it matches their Momence account email exactly.`
      );
      setNewEmail('');
      setNewIsAdmin(false);
      setNewPages(['/admin/schedule']);
    }
    await load();
    setBusy(false);
  };

  if (loading && users.length === 0) {
    return <p className="font-mono text-sm text-white/40">Loading…</p>;
  }

  const canAdd = EMAIL_RE.test(newEmail.trim()) && (newIsAdmin || newPages.length > 0);

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          {notice}
        </p>
      )}

      {source === 'env' && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          Access is still coming from the ADMIN_EMAILS env allowlist (no admin exists here yet). Add
          yourself as an admin below — from then on this page is the source of truth and the env
          vars are ignored.
        </p>
      )}

      <ul className="space-y-2">
        {users.map((u) => (
          <li
            key={u.id}
            className="space-y-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium">{u.email}</span>
              {u.display_name && (
                <span className="font-mono text-xs text-white/40">{u.display_name}</span>
              )}
              {u.email === self && (
                <span className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50">
                  you
                </span>
              )}
              <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={u.is_admin}
                  disabled={busy || u.email === self}
                  onChange={(e) => void patch(u.id, { isAdmin: e.target.checked })}
                />
                admin
              </label>
              <button
                type="button"
                className={`${buttonClass} ml-auto`}
                disabled={busy || u.email === self}
                onClick={() => void revoke(u)}
              >
                Revoke
              </button>
            </div>
            {u.is_admin ? (
              <p className="font-mono text-xs text-white/40">
                Admins can view every page and manage user access.
              </p>
            ) : (
              <PagePicker
                pages={u.pages}
                disabled={busy}
                onChange={(next) => void patch(u.id, { pages: next })}
              />
            )}
          </li>
        ))}
        {users.length === 0 && (
          <li className="rounded border border-white/10 bg-white/[0.03] px-3 py-4 font-mono text-xs text-white/40">
            No users yet.
          </li>
        )}
      </ul>

      {envUsers.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
            From env vars
          </h2>
          <p className="font-mono text-xs text-white/40">
            {envActive
              ? 'These come from ADMIN_EMAILS / STAFF_EMAILS and currently grant access (no admin exists here yet). Import them to manage access from this page instead.'
              : 'These are still listed in ADMIN_EMAILS / STAFF_EMAILS but no longer grant access — this page is the source of truth. Import anyone who should keep access; the env vars can be deleted from the deployment.'}
          </p>
          <ul className="space-y-2">
            {envUsers.map((u) => (
              <li
                key={u.email}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-dashed border-white/15 bg-white/[0.02] px-3 py-2"
              >
                <span className={`font-medium ${envActive ? '' : 'text-white/50'}`}>{u.email}</span>
                <span className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50">
                  {u.isAdmin ? 'admin_emails' : 'staff_emails'}
                </span>
                <span className="font-mono text-xs text-white/40">
                  {u.isAdmin
                    ? 'all pages'
                    : u.pages
                        .map((p) => ADMIN_TOOLS.find((t) => t.href === p)?.navLabel ?? p)
                        .join(', ')}
                </span>
                <button
                  type="button"
                  className={`${buttonClass} ml-auto`}
                  disabled={busy}
                  onClick={() => void importEnvUser(u)}
                >
                  Import
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3 rounded border border-white/10 bg-white/[0.03] px-3 py-3">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Add user
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${inputClass} w-72`}
            type="email"
            placeholder="momence login email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            aria-label="Momence login email"
          />
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              type="checkbox"
              checked={newIsAdmin}
              onChange={(e) => setNewIsAdmin(e.target.checked)}
            />
            admin
          </label>
        </div>
        {!newIsAdmin && <PagePicker pages={newPages} disabled={busy} onChange={setNewPages} />}
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !canAdd}
          onClick={() => void addUser()}
        >
          Add user
        </button>
      </div>
    </div>
  );
}
