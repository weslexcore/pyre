// People manager for /admin/users: one row per person, covering pay, roles
// (admin, founder, shift lead, available to schedule), and dashboard access
// (per-page grants). Each person is a one-line summary that expands into an
// editor, one at a time. Scheduling preferences (hours target, shifts per
// week) live on the schedule's Hours tab, not here. The API enforces the real
// guards (admin-only, last-admin/self protection, access needs an email);
// this island just mirrors them in the UI.
import { weekStartOf } from '@pyre/schedule-core';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { StaffRow, StaffStipendRow } from '@/lib/db';
import {
  ADMIN_TOOL_SECTIONS,
  ADMIN_TOOLS,
  BOARDS_HREF,
  GUESTS_MANAGE,
  INCIDENTS_MANAGE,
  isBoardGrantKey,
  LOST_FOUND_MANAGE,
  PARTNERS_MANAGE,
  REFERRALS_MANAGE,
  SCHEDULE_MANAGE,
} from './adminTools';

/** One board a 'board:<slug>' checkbox can grant, as the API lists them. */
interface BoardOption {
  slug: string;
  name: string;
  grantKey: string;
}

interface EnvUser {
  email: string;
  isAdmin: boolean;
  pages: string[];
}

interface UsersResponse {
  staff: StaffRow[];
  stipends?: StaffStipendRow[];
  boards?: BoardOption[];
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

/** A row's typed-but-unsaved text fields, as the inputs hold them. */
interface PersonDraft {
  name: string;
  email: string;
  payRate: string;
}

const draftFor = (s: StaffRow): PersonDraft => ({
  name: s.display_name,
  email: s.email ?? '',
  payRate: String(s.pay_rate ?? ''),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const todayLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

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
  '/admin/guests': {
    key: GUESTS_MANAGE,
    hint: 'Add, rename, re-order, and retire the questions on a guest profile. Without it: look guests up, edit their preferences and notes, and see who is booked into each session.',
  },
  '/admin/lost-found': {
    key: LOST_FOUND_MANAGE,
    hint: 'Email guests to ask whether a found item is theirs, and record donations to Furbish. Without it: log what you find, browse the log, and hand things back at the desk.',
  },
};

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * A person's recurring weekly stipends (extra paid hours for off-schedule
 * work like inventory or ordering), managed next to their pay rate. Weeks
 * snap to their Monday. One-week adjustments live on the hours report, where
 * the weeks are visible. Mutations go through /api/admin/stipends.
 */
function PersonStipends({
  person,
  stipends,
  disabled,
  onChanged,
}: {
  person: StaffRow;
  stipends: StaffStipendRow[];
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edits are typed before they're saved, so they live here until the row's
  // Save button goes (same pattern as the name/rate drafts above).
  const [drafts, setDrafts] = useState<
    Record<string, { label: string; hours: string; from: string; until: string }>
  >({});

  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newHours, setNewHours] = useState('');
  const [newFrom, setNewFrom] = useState(() => weekStartOf(todayLocal()));

  const call = async (method: string, body?: unknown, query = ''): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/stipends${query}`, {
      method,
      ...(body !== undefined
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    if (!res.ok) setError(await readError(res));
    // Rebuild row drafts from the fresh rows (the server may have snapped
    // dates to Mondays or trimmed the label).
    else setDrafts({});
    await onChanged();
    setBusy(false);
    return res.ok;
  };

  const off = disabled || busy;

  return (
    <div className="space-y-1.5">
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {stipends.map((stipend) => {
        const draft = drafts[stipend.id] ?? {
          label: stipend.label,
          hours: String(stipend.hours_per_week),
          from: stipend.effective_from,
          until: stipend.effective_until ?? '',
        };
        const dirty =
          draft.label.trim() !== stipend.label ||
          draft.hours.trim() !== String(stipend.hours_per_week) ||
          draft.from !== stipend.effective_from ||
          draft.until !== (stipend.effective_until ?? '');
        const setDraft = (fields: Partial<typeof draft>) =>
          setDrafts({ ...drafts, [stipend.id]: { ...draft, ...fields } });

        return (
          <div key={stipend.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50"
              title="Recurring weekly hours for off-schedule work, paid at the hourly rate and included in the hours report. To adjust a single week, use the hours report."
            >
              stipend
            </span>
            <input
              className={`${inputClass} w-48`}
              value={draft.label}
              disabled={off}
              onChange={(e) => setDraft({ label: e.target.value })}
              aria-label={`${person.display_name} stipend label`}
            />
            <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
              <input
                className={`${inputClass} w-20`}
                type="number"
                min={0.1}
                max={40}
                step={0.1}
                value={draft.hours}
                disabled={off}
                onChange={(e) => setDraft({ hours: e.target.value })}
                aria-label={`${person.display_name} stipend hours per week`}
              />
              h/wk
            </label>
            <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
              from
              <input
                className={inputClass}
                type="date"
                value={draft.from}
                disabled={off}
                onChange={(e) => e.target.value && setDraft({ from: e.target.value })}
                aria-label={`${person.display_name} stipend first week`}
              />
            </label>
            <label
              className="flex items-center gap-1.5 font-mono text-xs text-white/60"
              title="Last week this stipend pays — past weeks keep paying out. Leave blank to keep it running."
            >
              until
              <input
                className={inputClass}
                type="date"
                value={draft.until}
                disabled={off}
                onChange={(e) => setDraft({ until: e.target.value })}
                aria-label={`${person.display_name} stipend last week (blank = ongoing)`}
              />
            </label>
            {dirty && (
              <button
                type="button"
                className={buttonClass}
                disabled={off}
                onClick={() =>
                  void call('PATCH', {
                    id: stipend.id,
                    label: draft.label.trim(),
                    hoursPerWeek: Number(draft.hours),
                    effectiveFrom: draft.from,
                    effectiveUntil: draft.until || null,
                  })
                }
              >
                Save
              </button>
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={off}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${person.display_name}'s "${stipend.label}" stipend? It disappears from every week on the hours report, including ones already paid. To stop it going forward, set its last week instead.`
                  )
                )
                  void call('DELETE', undefined, `?id=${encodeURIComponent(stipend.id)}`);
              }}
            >
              Delete
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50">
            stipend
          </span>
          <input
            className={`${inputClass} w-48`}
            placeholder="what it's for"
            value={newLabel}
            disabled={off}
            onChange={(e) => setNewLabel(e.target.value)}
            aria-label={`${person.display_name} new stipend label`}
          />
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              className={`${inputClass} w-20`}
              type="number"
              min={0.1}
              max={40}
              step={0.1}
              placeholder="1"
              value={newHours}
              disabled={off}
              onChange={(e) => setNewHours(e.target.value)}
              aria-label={`${person.display_name} new stipend hours per week`}
            />
            h/wk
          </label>
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
            from
            <input
              className={inputClass}
              type="date"
              value={newFrom}
              disabled={off}
              onChange={(e) => e.target.value && setNewFrom(e.target.value)}
              aria-label={`${person.display_name} new stipend first week`}
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            disabled={off || !newLabel.trim() || !(Number(newHours) > 0)}
            onClick={() =>
              void call('POST', {
                staffId: person.id,
                label: newLabel.trim(),
                hoursPerWeek: Number(newHours),
                effectiveFrom: newFrom,
              }).then((ok) => {
                if (ok) {
                  setAdding(false);
                  setNewLabel('');
                  setNewHours('');
                }
              })
            }
          >
            Add
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={off}
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={buttonClass}
          disabled={off}
          title="Recurring weekly hours for off-schedule work (inventory, ordering...), paid at the hourly rate and included in the hours report."
          onClick={() => setAdding(true)}
        >
          Add stipend
        </button>
      )}
    </div>
  );
}

/** Titled block inside an open person editor. */
function EditorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/35">
        {title}
      </h3>
      {children}
    </section>
  );
}

function PagePicker({
  pages,
  boards,
  disabled,
  onChange,
}: {
  pages: string[];
  /** The live boards, from the users API. */
  boards: BoardOption[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  // Dropping a page drops its manage capability with it, so a revoked page
  // can't leave a dangling privilege behind. The Boards page is every board,
  // so granting it clears the per-board grants rather than leaving dead keys
  // nobody would think to untick later.
  const apply = (grant: string[], revoke: string[]) => {
    const revoked = new Set(revoke);
    for (const key of revoke) {
      const capability = MANAGE_CAPABILITIES[key];
      if (capability) revoked.add(capability.key);
    }
    let next = [...pages.filter((p) => !revoked.has(p)), ...grant];
    if (grant.includes(BOARDS_HREF)) next = next.filter((p) => !isBoardGrantKey(p));
    onChange([...new Set(next)]);
  };
  const toggle = (key: string, granted: boolean) => (granted ? apply([key], []) : apply([], [key]));

  return (
    <div className="space-y-4">
      {ADMIN_TOOL_SECTIONS.map((section) => {
        const tools = ADMIN_TOOLS.filter((tool) => tool.section === section.key);
        if (tools.length === 0) return null;
        const hrefs = tools.map((tool) => tool.href);
        const granted = hrefs.filter((href) => pages.includes(href)).length;
        const hasBoards = hrefs.includes(BOARDS_HREF);
        return (
          <div key={section.key} className="space-y-1.5">
            <div className="flex items-center gap-3 border-b border-white/5 pb-1">
              <span className="font-mono text-xs text-white/60">{section.label}</span>
              <span className="font-mono text-[10px] text-white/30">
                {granted}/{tools.length}
              </span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  className="font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white disabled:opacity-40"
                  disabled={disabled || granted === tools.length}
                  onClick={() => apply(hrefs, [])}
                >
                  All
                </button>
                <button
                  type="button"
                  className="font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white disabled:opacity-40"
                  disabled={
                    disabled || (granted === 0 && !(hasBoards && pages.some(isBoardGrantKey)))
                  }
                  onClick={() =>
                    apply([], [...hrefs, ...(hasBoards ? pages.filter(isBoardGrantKey) : [])])
                  }
                >
                  None
                </button>
              </span>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => {
                const on = pages.includes(tool.href);
                const capability = MANAGE_CAPABILITIES[tool.href];
                // One checkbox per board under Boards, so a community manager
                // can be given the rental pipeline and nothing else. Hidden
                // once the whole page is granted — that covers every board.
                const perBoard = tool.href === BOARDS_HREF && !on ? boards : [];
                return (
                  <div key={tool.href} className="space-y-1">
                    <label className={checkClass} title={tool.description}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        onChange={(e) => toggle(tool.href, e.target.checked)}
                      />
                      <span className={on ? 'text-[var(--pyre-creme)]' : ''}>{tool.navLabel}</span>
                    </label>
                    {capability && on && (
                      <label
                        className="ml-5 flex items-center gap-1.5 font-mono text-xs text-[var(--pyre-gold)]"
                        title={capability.hint}
                      >
                        <input
                          type="checkbox"
                          checked={pages.includes(capability.key)}
                          disabled={disabled}
                          onChange={(e) => toggle(capability.key, e.target.checked)}
                        />
                        can manage
                      </label>
                    )}
                    {perBoard.length > 0 && (
                      <div className="ml-5 space-y-1">
                        <p className="font-mono text-[10px] text-white/30">or only these boards:</p>
                        {perBoard.map((board) => (
                          <label
                            key={board.grantKey}
                            className="flex items-center gap-1.5 font-mono text-xs text-[var(--pyre-gold)]"
                            title={`Opens only the ${board.name} board`}
                          >
                            <input
                              type="checkbox"
                              checked={pages.includes(board.grantKey)}
                              disabled={disabled}
                              onChange={(e) => toggle(board.grantKey, e.target.checked)}
                            />
                            {board.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Roles {
  isAdmin: boolean;
  isFounder: boolean;
  isShiftLead: boolean;
  active: boolean;
}

const ROLE_OPTIONS: Array<{ key: keyof Roles; label: string; hint: string }> = [
  { key: 'isAdmin', label: 'Admin', hint: 'Sees every page, and manages this list and pay.' },
  {
    key: 'active',
    label: 'Available to schedule',
    hint: 'Can be assigned shifts, and can open Shift Notes (their own notes only). Turn off when someone leaves: their past shifts and hours stay, and they lose access.',
  },
  {
    key: 'isShiftLead',
    label: 'Shift lead',
    hint: 'Can anchor a shift. Anyone who is not a shift lead or founder must be scheduled alongside one.',
  },
  {
    key: 'isFounder',
    label: 'Founder',
    hint: 'Counts toward the % founders metric on the hours report.',
  },
];

function RoleToggles({
  roles,
  disabled,
  lockAdmin,
  onChange,
}: {
  roles: Roles;
  disabled: boolean;
  /** Your own admin box: you can't demote yourself. */
  lockAdmin?: boolean;
  onChange: (key: keyof Roles, value: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {ROLE_OPTIONS.map(({ key, label, hint }) => (
        <label
          key={key}
          className={`flex items-start gap-2 rounded border px-3 py-2 transition-colors ${
            roles[key] ? 'border-white/25 bg-white/[0.05]' : 'border-white/10'
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={roles[key]}
            disabled={disabled || (key === 'isAdmin' && lockAdmin)}
            onChange={(e) => onChange(key, e.target.checked)}
          />
          <span>
            <span className="block font-mono text-xs text-[var(--pyre-creme)]">{label}</span>
            <span className="block text-xs text-white/40">{hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const chipClass =
  'rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50';

/** One-line access summary for a collapsed row. */
function accessLabel(person: StaffRow): string {
  if (person.is_admin) return 'Admin';
  const pages = person.pages.filter((p) => ADMIN_TOOLS.some((t) => t.href === p)).length;
  const boards = person.pages.filter(isBoardGrantKey).length;
  const parts = [
    pages > 0 ? `${pages} page${pages === 1 ? '' : 's'}` : '',
    boards > 0 ? `${boards} board${boards === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' + ') : 'No access';
}

const isFormer = (person: StaffRow): boolean =>
  !person.active && !person.is_admin && person.pages.length === 0;

const fmtRate = (rate: number | null): string =>
  rate == null
    ? ''
    : `$${Number.isInteger(Number(rate)) ? Number(rate) : Number(rate).toFixed(2)}/hr`;

export function UsersManager() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [stipends, setStipends] = useState<StaffStipendRow[]>([]);
  const [envUsers, setEnvUsers] = useState<EnvUser[]>([]);
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [envActive, setEnvActive] = useState(false);
  const [self, setSelf] = useState('');
  const [source, setSource] = useState<'db' | 'env'>('db');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Which person's editor is open ('new' = the add form); one at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showFormer, setShowFormer] = useState(false);

  // Name/email/rate edits are typed before they're saved, so they live here
  // until the row's Save button goes.
  const [drafts, setDrafts] = useState<Record<string, PersonDraft>>({});

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  // Blank = let the API default apply (20, or 0 for founders).
  const [newPayRate, setNewPayRate] = useState('');
  const [newRoles, setNewRoles] = useState<Roles>({
    isAdmin: false,
    isFounder: false,
    isShiftLead: false,
    active: true,
  });
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
      setStipends(body.stipends ?? []);
      setBoards(body.boards ?? []);
      setDrafts(Object.fromEntries(body.staff.map((s) => [s.id, draftFor(s)])));
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
    } else {
      setOpenId(null);
      if (((await res.json()) as { deactivated: boolean }).deactivated) {
        setNotice(
          `${person.display_name} has shifts or time off on record, so they were taken off the schedule and had their access removed instead of being deleted.`
        );
      }
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

  const resetNew = () => {
    setNewName('');
    setNewEmail('');
    setNewPayRate('');
    setNewRoles({ isAdmin: false, isFounder: false, isShiftLead: false, active: true });
    setNewPages(['/admin/schedule']);
  };

  const addPerson = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const person = await create({
      displayName: newName.trim(),
      email: newEmail.trim(),
      isAdmin: newRoles.isAdmin,
      pages: newRoles.isAdmin ? [] : newPages,
      isFounder: newRoles.isFounder,
      isShiftLead: newRoles.isShiftLead,
      active: newRoles.active,
      ...(newPayRate.trim() !== '' ? { payRate: Number(newPayRate) } : {}),
    });
    if (person) {
      resetNew();
      setOpenId(person.id);
    }
    invalidateJson('/api/admin/schedule-board');
    await load();
    setBusy(false);
  };

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return staff.filter(
      (person) =>
        (showFormer || !isFormer(person) || person.id === openId) &&
        (!needle ||
          person.display_name.toLowerCase().includes(needle) ||
          (person.email ?? '').includes(needle))
    );
  }, [staff, filter, showFormer, openId]);

  if (loading && staff.length === 0) {
    return <p className="font-mono text-sm text-white/40">Loading…</p>;
  }

  const formerCount = staff.filter(isFormer).length;
  const trimmedNewEmail = newEmail.trim();
  const grantsAccess = newRoles.isAdmin || newPages.length > 0;
  const canAdd =
    (trimmedNewEmail ? EMAIL_RE.test(trimmedNewEmail) : !grantsAccess) &&
    (newName.trim().length > 0 || trimmedNewEmail.length > 0);

  const missingEmails = staff.filter((s) => s.active && !s.email);

  const banner = (tone: 'red' | 'gold', text: ReactNode) => (
    <p
      className={`rounded border px-3 py-2 font-mono text-xs ${
        tone === 'red'
          ? 'border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 text-[var(--pyre-red)]'
          : 'border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]'
      }`}
    >
      {text}
    </p>
  );

  return (
    <div className="space-y-6">
      {error && banner('red', error)}
      {notice && banner('gold', notice)}

      {source === 'env' &&
        banner(
          'gold',
          'Access is still coming from the ADMIN_EMAILS env allowlist (no admin exists here yet). Add yourself as an admin below — from then on this page is the source of truth and the env vars are ignored.'
        )}

      {missingEmails.length > 0 &&
        banner(
          'gold',
          `Missing Momence emails: ${missingEmails.map((s) => s.display_name).join(', ')} — they can be scheduled, but can't sign in or see their own shifts until it's set.`
        )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${inputClass} w-full sm:w-64`}
          type="search"
          placeholder="Find by name or email"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Find a person"
        />
        {formerCount > 0 && (
          <label className={checkClass}>
            <input
              type="checkbox"
              checked={showFormer}
              onChange={(e) => setShowFormer(e.target.checked)}
            />
            show {formerCount} former
          </label>
        )}
        <button
          type="button"
          className={`${buttonClass} ml-auto`}
          disabled={busy}
          onClick={() => setOpenId(openId === 'new' ? null : 'new')}
        >
          {openId === 'new' ? 'Cancel' : 'Add person'}
        </button>
      </div>

      {openId === 'new' && (
        <div className="space-y-5 rounded border border-white/20 bg-white/[0.04] px-4 py-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/60">
            Add person
          </h2>
          <EditorSection title="Details">
            <div className="flex flex-wrap items-center gap-3">
              <input
                className={`${inputClass} w-44`}
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
                  placeholder={newRoles.isFounder ? '0' : '20'}
                  value={newPayRate}
                  onChange={(e) => setNewPayRate(e.target.value)}
                  aria-label="Hourly pay rate"
                />
                $/hr
              </label>
            </div>
            <p className="font-mono text-xs text-white/40">
              Leave the email blank for someone who is only scheduled. It can be filled in later,
              and dashboard access needs it.
            </p>
          </EditorSection>
          <EditorSection title="Roles">
            <RoleToggles
              roles={newRoles}
              disabled={busy}
              onChange={(key, value) => setNewRoles({ ...newRoles, [key]: value })}
            />
          </EditorSection>
          <EditorSection title="Page access">
            {newRoles.isAdmin ? (
              <p className="font-mono text-xs text-white/40">Admins can view every page.</p>
            ) : (
              <PagePicker pages={newPages} boards={boards} disabled={busy} onChange={setNewPages} />
            )}
          </EditorSection>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !canAdd}
              onClick={() => void addPerson()}
            >
              Add person
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                resetNew();
                setOpenId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.02]">
        {visible.map((person) => {
          const saved = draftFor(person);
          const draft = drafts[person.id] ?? saved;
          const dirty = (Object.keys(saved) as Array<keyof PersonDraft>).some(
            (k) => draft[k].trim() !== saved[k]
          );
          const isSelf = !!person.email && person.email === self;
          const open = openId === person.id;
          const setDraft = (fields: Partial<PersonDraft>) =>
            setDrafts({ ...drafts, [person.id]: { ...draft, ...fields } });

          return (
            <li key={person.id} className={open ? 'bg-white/[0.04]' : ''}>
              <button
                type="button"
                className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-white/[0.04] ${
                  isFormer(person) ? 'opacity-50' : ''
                }`}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : person.id)}
              >
                <span
                  className={`inline-block w-3 font-mono text-xs text-white/40 transition-transform ${open ? 'rotate-90' : ''}`}
                >
                  ›
                </span>
                <span className="font-medium text-[var(--pyre-creme)]">{person.display_name}</span>
                {isSelf && <span className={chipClass}>you</span>}
                <span className="truncate font-mono text-xs text-white/35">
                  {person.email ?? 'no email'}
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {person.is_founder && <span className={chipClass}>founder</span>}
                  {person.is_shift_lead && <span className={chipClass}>shift lead</span>}
                  {!person.active && <span className={chipClass}>not scheduled</span>}
                  <span
                    className={`${chipClass} ${person.is_admin ? 'border-[var(--pyre-red)]/50 text-[var(--pyre-creme)]' : ''}`}
                  >
                    {accessLabel(person)}
                  </span>
                  <span className="w-20 text-right font-mono text-xs text-white/60">
                    {fmtRate(person.pay_rate)}
                  </span>
                </span>
              </button>

              {open && (
                <div className="space-y-5 border-t border-white/5 px-4 pb-4 pt-3">
                  <EditorSection title="Details">
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        className={`${inputClass} w-44`}
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
                          className={`${inputClass} w-24`}
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
                              ...(draft.payRate.trim() !== ''
                                ? { payRate: Number(draft.payRate) }
                                : {}),
                            })
                          }
                        >
                          Save
                        </button>
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
                    <p className="font-mono text-xs text-white/40">
                      Shift preferences (hours target, shifts per week) are set on{' '}
                      <a
                        href="/admin/schedule/hours"
                        className="underline decoration-white/20 hover:text-white"
                      >
                        Schedule → Hours
                      </a>
                      .
                    </p>
                  </EditorSection>

                  <EditorSection title="Roles">
                    <RoleToggles
                      roles={{
                        isAdmin: person.is_admin,
                        isFounder: person.is_founder,
                        isShiftLead: person.is_shift_lead,
                        active: person.active,
                      }}
                      disabled={busy}
                      lockAdmin={isSelf}
                      onChange={(key, value) => void patch(person.id, { [key]: value })}
                    />
                  </EditorSection>

                  <EditorSection title="Page access">
                    {person.is_admin ? (
                      <p className="font-mono text-xs text-white/40">
                        Admins can view every page and manage this list.
                      </p>
                    ) : (
                      <PagePicker
                        pages={person.pages}
                        boards={boards}
                        disabled={busy}
                        onChange={(next) => void patch(person.id, { pages: next })}
                      />
                    )}
                  </EditorSection>

                  <EditorSection title="Stipends">
                    <PersonStipends
                      person={person}
                      stipends={stipends.filter((s) => s.staff_id === person.id)}
                      disabled={busy}
                      onChanged={async () => {
                        // The hours report folds stipends into its cached
                        // schedule-board payload, so stipend edits drop it too.
                        invalidateJson('/api/admin/schedule-board');
                        await load();
                      }}
                    />
                  </EditorSection>
                </div>
              )}
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-4 font-mono text-xs text-white/40">
            {staff.length === 0 ? 'Nobody yet.' : 'Nobody matches.'}
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
                <span className={chipClass}>{u.isAdmin ? 'admin_emails' : 'staff_emails'}</span>
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
    </div>
  );
}
