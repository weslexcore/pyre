// Roster management: the Momence email on each row is what links a login to
// their schedule (Phase 2's employee pages match the OAuth profile email
// against it), so the panel nags about missing emails. People are
// deactivated, never deleted — their assignment history stays.
import { useCallback, useEffect, useState } from 'react';
import type { ScheduleStaffRow } from '@/lib/db';

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

export function ScheduleRoster() {
  const [staff, setStaff] = useState<ScheduleStaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/schedule-staff');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { staff: ScheduleStaffRow[] };
      setStaff(body.staff);
      setEmailDrafts(Object.fromEntries(body.staff.map((s) => [s.id, s.momence_email ?? ''])));
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
    const res = await fetch('/api/admin/schedule-staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) {
      try {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      } catch {
        setError(`HTTP ${res.status}`);
      }
    }
    await load();
    setBusy(false);
  };

  const addPerson = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/schedule-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: newName.trim() }),
    });
    if (!res.ok) {
      try {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      } catch {
        setError(`HTTP ${res.status}`);
      }
    } else {
      setNewName('');
    }
    await load();
    setBusy(false);
  };

  if (loading && staff.length === 0) {
    return <p className="font-mono text-sm text-white/40">Loading…</p>;
  }

  const missingEmails = staff.filter((s) => s.active && !s.momence_email);

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {missingEmails.length > 0 && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          Missing Momence emails: {missingEmails.map((s) => s.display_name).join(', ')} — they can't
          be matched to a login until set.
        </p>
      )}

      <ul className="space-y-2">
        {staff.map((s) => (
          <li
            key={s.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 ${s.active ? '' : 'opacity-50'}`}
          >
            <span className="w-24 font-medium">{s.display_name}</span>
            <input
              className={`${inputClass} w-64`}
              type="email"
              placeholder="momence email"
              value={emailDrafts[s.id] ?? ''}
              onChange={(e) => setEmailDrafts({ ...emailDrafts, [s.id]: e.target.value })}
              aria-label={`${s.display_name} Momence email`}
            />
            {(emailDrafts[s.id] ?? '') !== (s.momence_email ?? '') && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => void patch(s.id, { momenceEmail: emailDrafts[s.id] || null })}
              >
                Save email
              </button>
            )}
            <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
              <input
                type="checkbox"
                checked={s.is_founder}
                disabled={busy}
                onChange={(e) => void patch(s.id, { isFounder: e.target.checked })}
              />
              founder
            </label>
            <button
              type="button"
              className={`${buttonClass} ml-auto`}
              disabled={busy}
              onClick={() => void patch(s.id, { active: !s.active })}
            >
              {s.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={inputClass}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New person's name"
          aria-label="New person's name"
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => void addPerson()}
          disabled={busy || !newName.trim()}
        >
          Add person
        </button>
      </div>
    </div>
  );
}
