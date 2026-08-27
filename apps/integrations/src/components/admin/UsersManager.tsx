// People manager for /admin/users: one row per person, covering dashboard
// access (admin / per-page grants) and the scheduling roster (founder,
// available to schedule) — these used to be two pages against two tables.
// The API enforces the real guards (admin-only, last-admin/self protection,
// access needs an email); this island just mirrors them in the UI.
import { useCallback, useEffect, useState } from 'react';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { StaffRow } from '@/lib/db';
import {
  ADMIN_TOOLS,
  INCIDENTS_MANAGE,
  PARTNERS_MANAGE,
  REFERRALS_MANAGE,
  SCHEDULE_MANAGE,
} from './adminTools';

interface EnvUser {
  email: string;
  isAdmin: boolean;
  pages: string[];
}

interface UsersResponse {
  staff: StaffRow[];
  envUsers: EnvUser[];
  envActive: boolean;
  self: string;
  source: 'db' | 'env';
}

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const checkClass = 'flex items-center gap-1.5 font-mono text-xs text-white/60';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pages that split view from manage: granting the page is the read/participate
// level, and the extra "manage" box is the privileged half. Each entry is only
// offered once the page itself is granted, and is dropped with it.
const MANAGE_CAPABILITIES: Record<string, { key: string; hint: string }> = {
  '/admin/schedule': {
    key: SCHEDULE_MANAGE,
    hint: "Edit shifts and the roster, sync Momence, review AI drafts, and manage everyone's time off. Without it: view the schedule and manage own blackout dates only.",
  },
  '/admin/partners': {
    key: PARTNERS_MANAGE,
    hint: 'Edit partners and act on verification requests. Without it: browse the registry and the queue read-only.',
  },
  '/admin/referrals': {
    key: REFERRALS_MANAGE,
    hint: 'Create and edit referrers and tiers, and revoke redemptions and rewards. Without it: read-only.',
  },
  '/admin/incidents': {
    key: INCIDENTS_MANAGE,
    hint: 'Read the whole incident log, review and edit reports, and resolve them. Without it: file reports and read back the ones you were part of.',
  },
};

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
    // Dropping a page drops its manage capability with it, so a revoked page
    // can't leave a dangling privilege behind.
    const capability = MANAGE_CAPABILITIES[key];
    if (capability && !granted) next = next.filter((p) => p !== capability.key);
    onChange([...new Set(next)]);
  };

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {ADMIN_TOOLS.map((tool) => {
        const capability = MANAGE_CAPABILITIES[tool.href];
        return (
          <span key={tool.href} className="flex items-center gap-2">
            <label className={checkClass}>
              <input
                type="checkbox"
                checked={pages.includes(tool.href)}
                disabled={disabled}
                onChange={(e) => toggle(tool.href, e.target.checked)}
              />
              {tool.navLabel}
            </label>
            {capability && pages.includes(tool.href) && (
              <label
                className="flex items-center gap-1.5 font-mono text-xs text-[var(--pyre-gold)]"
                title={capability.hint}
              >
                <input
                  type="checkbox"
                  checked={pages.includes(capability.key)}
                  disabled={disabled}
                  onChange={(e) => toggle(capability.key, e.target.checked)}
                />
                manage
              </label>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function UsersManager() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [envUsers, setEnvUsers] = useState<EnvUser[]>([]);
  const [envActive, setEnvActive] = useState(false);
  const [self, setSelf] = useState('');
  const [source, setSource] = useState<'db' | 'env'>('db');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Name/email/rate/target edits are typed before they're saved, so they live
  // here until the row's Save button goes.
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; email: string; payRate: string; targetHours: string }>
  >({});

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newIsFounder, setNewIsFounder] = useState(false);
  const [newIsShiftLead, setNewIsShiftLead] = useState(false);
  const [newActive, setNewActive] = useState(true);
  // Blank = let the API default apply (20, or 0 for founders).
  const [newPayRate, setNewPayRate] = useState('');
  // Employee default: view the schedule, manage their own blackout dates.
  const [newPages, setNewPages] = useState<string[]>(['/admin/schedule']);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as UsersResponse;
      setStaff(body.staff);
      setDrafts(
        Object.fromEntries(
          body.staff.map((s) => [
            s.id,
            {
              name: s.display_name,
              email: s.email ?? '',
              payRate: String(s.pay_rate ?? ''),
              targetHours: String(s.target_hours_per_week ?? ''),
            },
          ])
        )
      );
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
    setNotice(null);
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) {
      setError(await readError(res));
    } else {
      const body = (await res.json()) as { person: StaffRow; momenceMatch?: boolean };
      if (body.momenceMatch === false) {
        setNotice(
          `No Momence member matched ${body.person.email} — they can only log in if it matches their Momence account email exactly.`
        );
      }
    }
    // Staff rows ride along in the schedule-board payload that the Calendar
    // and Hours tabs cache, so every roster edit drops their entries too.
    invalidateJson('/api/admin/schedule-board');
    await load();
    setBusy(false);
  };

  const remove = async (person: StaffRow) => {
    if (!window.confirm(`Remove ${person.display_name}? Their schedule history is kept.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/users?id=${encodeURIComponent(person.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setError(await readError(res));
    } else if (((await res.json()) as { deactivated: boolean }).deactivated) {
      setNotice(
        `${person.display_name} has shifts or time off on record, so they were taken off the schedule and had their access removed instead of being deleted.`
      );
    }
    invalidateJson('/api/admin/schedule-board');
    await load();
    setBusy(false);
  };

  const create = async (fields: Record<string, unknown>): Promise<StaffRow | null> => {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      setError(await readError(res));
      return null;
    }
    const body = (await res.json()) as { person: StaffRow; momenceMatch: boolean };
    if (body.person.email && !body.momenceMatch) {
      setNotice(
        `Added ${body.person.display_name} — no Momence member matched ${body.person.email}. They can only log in if it matches their Momence account email exactly.`
      );
    }
    return body.person;
  };

  const importEnvUser = async (envUser: EnvUser) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const person = await create({
      email: envUser.email,
      isAdmin: envUser.isAdmin,
      pages: envUser.pages,
    });
    if (person) setNotice(`Imported ${envUser.email} — they're now managed from this page.`);
    invalidateJson('/api/admin/schedule-board');
    await load();
    setBusy(false);
  };

  const addPerson = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const person = await create({
      displayName: newName.trim(),
      email: newEmail.trim(),
      isAdmin: newIsAdmin,
      pages: newIsAdmin ? [] : newPages,
      isFounder: newIsFounder,
      isShiftLead: newIsShiftLead,
      active: newActive,
      ...(newPayRate.trim() !== '' ? { payRate: Number(newPayRate) } : {}),
    });
    if (person) {
      setNewName('');
      setNewEmail('');
      setNewIsAdmin(false);
      setNewIsFounder(false);
      setNewIsShiftLead(false);
      setNewActive(true);
      setNewPages(['/admin/schedule']);
      setNewPayRate('');
    }
    invalidateJson('/api/admin/schedule-board');
    await load();
    setBusy(false);
  };

  if (loading && staff.length === 0) {
    return <p className="font-mono text-sm text-white/40">Loading…</p>;
  }

  const trimmedNewEmail = newEmail.trim();
  const grantsAccess = newIsAdmin || newPages.length > 0;
  const canAdd =
    (trimmedNewEmail ? EMAIL_RE.test(trimmedNewEmail) : !grantsAccess) &&
    (newName.trim().length > 0 || trimmedNewEmail.length > 0);

  const missingEmails = staff.filter((s) => s.active && !s.email);

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

      {missingEmails.length > 0 && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          Missing Momence emails: {missingEmails.map((s) => s.display_name).join(', ')} — they can
          be scheduled, but can't sign in or see their own shifts until it's set.
        </p>
      )}

      <ul className="space-y-2">
        {staff.map((person) => {
          const draft = drafts[person.id] ?? {
            name: person.display_name,
            email: person.email ?? '',
            payRate: String(person.pay_rate ?? ''),
            targetHours: String(person.target_hours_per_week ?? ''),
          };
          const dirty =
            draft.name.trim() !== person.display_name ||
            draft.email.trim() !== (person.email ?? '') ||
            draft.payRate.trim() !== String(person.pay_rate ?? '') ||
            draft.targetHours.trim() !== String(person.target_hours_per_week ?? '');
          const isSelf = !!person.email && person.email === self;
          const setDraft = (
            fields: Partial<{ name: string; email: string; payRate: string; targetHours: string }>
          ) => setDrafts({ ...drafts, [person.id]: { ...draft, ...fields } });

          return (
            <li
              key={person.id}
              className={`space-y-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 ${
                person.active || person.is_admin || person.pages.length > 0 ? '' : 'opacity-60'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <input
                  className={`${inputClass} w-36`}
                  value={draft.name}
                  disabled={busy}
                  onChange={(e) => setDraft({ name: e.target.value })}
                  aria-label={`${person.display_name} name`}
                />
                <input
                  className={`${inputClass} w-64`}
                  type="email"
                  placeholder="momence login email"
                  value={draft.email}
                  disabled={busy || isSelf}
                  onChange={(e) => setDraft({ email: e.target.value })}
                  aria-label={`${person.display_name} Momence email`}
                />
                <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
                  <input
                    className={`${inputClass} w-20`}
                    type="number"
                    min={0}
                    step={0.5}
                    value={draft.payRate}
                    disabled={busy}
                    onChange={(e) => setDraft({ payRate: e.target.value })}
                    aria-label={`${person.display_name} hourly pay rate`}
                  />
                  $/hr
                </label>
                <label
                  className="flex items-center gap-1.5 font-mono text-xs text-white/60"
                  title="Desired scheduled hours per week — drives the Insights consistency flags. Leave blank for no target (e.g. founders or truly flexible people)."
                >
                  <input
                    className={`${inputClass} w-20`}
                    type="number"
                    min={0}
                    step={0.5}
                    value={draft.targetHours}
                    disabled={busy}
                    onChange={(e) => setDraft({ targetHours: e.target.value })}
                    aria-label={`${person.display_name} target hours per week`}
                  />
                  h/wk target
                </label>
                {dirty && (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() =>
                      void patch(person.id, {
                        displayName: draft.name.trim(),
                        email: draft.email.trim() || null,
                        // Blank keeps the stored rate — Number('') would be 0.
                        ...(draft.payRate.trim() !== '' ? { payRate: Number(draft.payRate) } : {}),
                        // Unlike payRate, blank CLEARS the target (the column
                        // is nullable and "no target" must be settable).
                        targetHours:
                          draft.targetHours.trim() === '' ? null : Number(draft.targetHours),
                      })
                    }
                  >
                    Save
                  </button>
                )}
                {isSelf && (
                  <span className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50">
                    you
                  </span>
                )}
                <button
                  type="button"
                  className={`${buttonClass} ml-auto`}
                  disabled={busy || isSelf}
                  onClick={() => void remove(person)}
                >
                  Remove
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <label className={checkClass} title="Sees every admin page and manages this list.">
                  <input
                    type="checkbox"
                    checked={person.is_admin}
                    disabled={busy || isSelf}
                    onChange={(e) => void patch(person.id, { isAdmin: e.target.checked })}
                  />
                  admin
                </label>
                <label
                  className={checkClass}
                  title="Counts toward the % founders coverage metric on the hours report."
                >
                  <input
                    type="checkbox"
                    checked={person.is_founder}
                    disabled={busy}
                    onChange={(e) => void patch(person.id, { isFounder: e.target.checked })}
                  />
                  founder
                </label>
                <label
                  className={checkClass}
                  title="Can anchor a shift. Anyone without this (or founder) must be scheduled with a founder or shift lead — the boards flag shifts that break the rule."
                >
                  <input
                    type="checkbox"
                    checked={person.is_shift_lead}
                    disabled={busy}
                    onChange={(e) => void patch(person.id, { isShiftLead: e.target.checked })}
                  />
                  shift lead
                </label>
                <label
                  className={checkClass}
                  title="Assignable on the shift board, and unlocks the Shift Notes page (their own notes only) with no page grant needed. Turn off when someone leaves — their past shifts and hours stay, and their access goes."
                >
                  <input
                    type="checkbox"
                    checked={person.active}
                    disabled={busy}
                    onChange={(e) => void patch(person.id, { active: e.target.checked })}
                  />
                  available to schedule
                </label>
              </div>

              {person.is_admin ? (
                <p className="font-mono text-xs text-white/40">
                  Admins can view every page and manage this list.
                </p>
              ) : (
                <PagePicker
                  pages={person.pages}
                  disabled={busy}
                  onChange={(next) => void patch(person.id, { pages: next })}
                />
              )}
            </li>
          );
        })}
        {staff.length === 0 && (
          <li className="rounded border border-white/10 bg-white/[0.03] px-3 py-4 font-mono text-xs text-white/40">
            Nobody yet.
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
          Add person
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${inputClass} w-36`}
            placeholder="name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="Name"
          />
          <input
            className={`${inputClass} w-64`}
            type="email"
            placeholder="momence login email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            aria-label="Momence login email"
          />
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              className={`${inputClass} w-24`}
              type="number"
              min={0}
              step={0.5}
              placeholder="20 (0 for founders)"
              value={newPayRate}
              onChange={(e) => setNewPayRate(e.target.value)}
              aria-label="Hourly pay rate"
            />
            $/hr
          </label>
          <label className={checkClass}>
            <input
              type="checkbox"
              checked={newIsAdmin}
              onChange={(e) => setNewIsAdmin(e.target.checked)}
            />
            admin
          </label>
          <label className={checkClass}>
            <input
              type="checkbox"
              checked={newIsFounder}
              onChange={(e) => setNewIsFounder(e.target.checked)}
            />
            founder
          </label>
          <label className={checkClass}>
            <input
              type="checkbox"
              checked={newIsShiftLead}
              onChange={(e) => setNewIsShiftLead(e.target.checked)}
            />
            shift lead
          </label>
          <label className={checkClass}>
            <input
              type="checkbox"
              checked={newActive}
              onChange={(e) => setNewActive(e.target.checked)}
            />
            available to schedule
          </label>
        </div>
        {!newIsAdmin && <PagePicker pages={newPages} disabled={busy} onChange={setNewPages} />}
        <p className="font-mono text-xs text-white/40">
          Leave the email blank for someone who is only scheduled — it can be filled in later, and
          dashboard access needs it.
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !canAdd}
          onClick={() => void addPerson()}
        >
          Add person
        </button>
      </div>
    </div>
  );
}
