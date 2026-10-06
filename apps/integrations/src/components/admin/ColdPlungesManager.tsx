// The cold plunge list (/admin/water/plunges), for admins.
//
// Each plunge has a name and the gallons it holds — the water log sizes every
// recommended dose from that volume (the manual's charts are written for a
// 120 gal tub). Plunges can be renamed, resized, re-ordered, and archived.
// Archiving hides one from the entry form while its history stays in the log;
// only a plunge with no log entries can be deleted outright.

import { useMemo, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { isSessionExpired, SessionExpired } from '@/components/admin/SessionExpired';
import {
  buttonClass,
  cardClass,
  formButtonClass,
  goldButtonClass,
  inputClass,
  labelClass,
} from '@/components/admin/ui';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { ColdPlungeRow } from '@/lib/db';
import { CHART_GALLONS } from '@/lib/water/charts';
import { formatGallons, PLUNGE_LIMITS } from '@/lib/water/plunges';

const PLUNGES_URL = '/api/admin/cold-plunges';

interface PlungesResponse {
  plunges: ColdPlungeRow[];
  entries: Record<string, number>;
  canManage: boolean;
}

interface Draft {
  name: string;
  gallons: string;
}

const draftFor = (plunge: ColdPlungeRow): Draft => ({
  name: plunge.name,
  gallons: formatGallons(plunge.gallons),
});

export function ColdPlungesManager() {
  const { data, error, loading, setData, reload } = useCachedJson<PlungesResponse>(PLUNGES_URL);
  const plunges = useMemo(() => data?.plunges ?? [], [data]);
  const entries = data?.entries ?? {};
  const active = plunges.filter((p) => !p.archived);
  const archived = plunges.filter((p) => p.archived);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', gallons: '' });
  const [newPlunge, setNewPlunge] = useState<Draft>({ name: '', gallons: String(CHART_GALLONS) });

  // Every change goes through here: run it, refresh the list, and drop the
  // water log's cached copy so it picks up the new names and volumes.
  const run = async (key: string, action: () => Promise<void>): Promise<boolean> => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      invalidateJson(PLUNGES_URL);
      await reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setExpired(true);
      setMessage(e instanceof Error ? e.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const ok = await run('add', async () => {
      await sendJson(PLUNGES_URL, 'POST', { name: newPlunge.name, gallons: newPlunge.gallons });
    });
    if (ok) setNewPlunge({ name: '', gallons: String(CHART_GALLONS) });
  };

  const saveEdit = async (plunge: ColdPlungeRow) => {
    const ok = await run(plunge.id, async () => {
      await sendJson(PLUNGES_URL, 'PATCH', {
        id: plunge.id,
        name: draft.name,
        gallons: draft.gallons,
      });
    });
    if (ok) setEditingId(null);
  };

  const setArchived = (plunge: ColdPlungeRow, value: boolean) =>
    run(plunge.id, async () => {
      await sendJson(PLUNGES_URL, 'PATCH', { id: plunge.id, archived: value });
    });

  const move = (plunge: ColdPlungeRow, by: -1 | 1) => {
    const ids = active.map((p) => p.id);
    const from = ids.indexOf(plunge.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    // Archived plunges keep their place after the active ones.
    const order = [...ids, ...archived.map((p) => p.id)];
    void run(plunge.id, async () => {
      const result = await sendJson<{ plunges: ColdPlungeRow[] }>(PLUNGES_URL, 'PATCH', { order });
      setData((prev) => (prev ? { ...prev, plunges: result.plunges } : prev));
    });
  };

  const remove = async (plunge: ColdPlungeRow) => {
    if (
      !(await confirmAction({
        title: `Delete ${plunge.name}?`,
        body: 'It has no log entries, so nothing else is lost. This can’t be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    await run(plunge.id, async () => {
      await sendJson(`${PLUNGES_URL}?id=${encodeURIComponent(plunge.id)}`, 'DELETE');
    });
  };

  if (expired || isSessionExpired(error)) {
    return <SessionExpired returnTo="/admin/water/plunges" />;
  }

  const row = (plunge: ColdPlungeRow, index: number) => {
    const count = entries[plunge.id] ?? 0;
    const editing = editingId === plunge.id;
    const rowBusy = busy === plunge.id;

    if (editing) {
      return (
        <li key={plunge.id} className={cardClass}>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <label>
              <span className={labelClass}>Name</span>
              <input
                value={draft.name}
                maxLength={PLUNGE_LIMITS.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className={`${inputClass} w-full`}
              />
            </label>
            <label>
              <span className={labelClass}>Gallons</span>
              <input
                value={draft.gallons}
                inputMode="decimal"
                onChange={(e) => setDraft((d) => ({ ...d, gallons: e.target.value }))}
                className={`${inputClass} w-full`}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-white/40">
            Changing the gallons changes the doses recommended from now on. Entries already logged
            keep the amounts that were added.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void saveEdit(plunge)}
              disabled={rowBusy}
              className={goldButtonClass}
            >
              {rowBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              disabled={rowBusy}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>
        </li>
      );
    }

    return (
      <li key={plunge.id} className={`${cardClass} flex flex-wrap items-center gap-3`}>
        <div className="min-w-0 flex-1">
          <div className="font-primary-semibold">{plunge.name}</div>
          <div className="font-mono text-xs text-white/40">
            {formatGallons(plunge.gallons)} gal · {count} log {count === 1 ? 'entry' : 'entries'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!plunge.archived && (
            <>
              <button
                type="button"
                aria-label={`Move ${plunge.name} up`}
                onClick={() => move(plunge, -1)}
                disabled={busy !== null || index === 0}
                className={buttonClass}
              >
                Up
              </button>
              <button
                type="button"
                aria-label={`Move ${plunge.name} down`}
                onClick={() => move(plunge, 1)}
                disabled={busy !== null || index === active.length - 1}
                className={buttonClass}
              >
                Down
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(plunge.id);
                  setDraft(draftFor(plunge));
                }}
                disabled={busy !== null}
                className={buttonClass}
              >
                Edit
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void setArchived(plunge, !plunge.archived)}
            disabled={busy !== null}
            className={buttonClass}
          >
            {plunge.archived ? 'Restore' : 'Archive'}
          </button>
          {count === 0 && (
            <button
              type="button"
              onClick={() => void remove(plunge)}
              disabled={busy !== null}
              className={`${buttonClass} hover:border-[var(--pyre-red)] hover:text-[var(--pyre-red)]`}
            >
              Delete
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-6 text-sm text-white/60">
        Every recommended dose in the water log is sized from the plunge's gallons. The manual's
        charts are written for a {CHART_GALLONS} gal tub, so a plunge half that size gets half the
        amount.
      </p>

      {message && (
        <p role="alert" className="mb-4 text-sm text-[var(--pyre-red)]">
          {message}
        </p>
      )}

      {error && !data ? (
        <p className="text-sm text-[var(--pyre-red)]">
          Couldn't load the plunges ({error}).{' '}
          <button type="button" onClick={() => void reload()} className="underline">
            Retry
          </button>
        </p>
      ) : loading && !data ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="mb-4 text-sm text-white/50">No active plunges. Add one below.</p>
          ) : (
            <ul className="mb-6 space-y-2">{active.map((plunge, i) => row(plunge, i))}</ul>
          )}

          <form
            className={`${cardClass} mb-8`}
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="mb-3 font-mono text-xs uppercase tracking-wide text-white/50">
              Add a plunge
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <label>
                <span className={labelClass}>Name</span>
                <input
                  value={newPlunge.name}
                  maxLength={PLUNGE_LIMITS.name}
                  placeholder="e.g. Garden plunge"
                  onChange={(e) => setNewPlunge((d) => ({ ...d, name: e.target.value }))}
                  className={`${inputClass} w-full`}
                />
              </label>
              <label>
                <span className={labelClass}>Gallons</span>
                <input
                  value={newPlunge.gallons}
                  inputMode="decimal"
                  onChange={(e) => setNewPlunge((d) => ({ ...d, gallons: e.target.value }))}
                  className={`${inputClass} w-full`}
                />
              </label>
              <button
                type="submit"
                disabled={busy !== null || !newPlunge.name.trim()}
                className={formButtonClass}
              >
                {busy === 'add' ? 'Adding…' : 'Add'}
              </button>
            </div>
          </form>

          {archived.length > 0 && (
            <>
              <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-white/50">
                Archived
              </h2>
              <p className="mb-3 text-xs text-white/40">
                Hidden from the entry form. Their history stays in the log, charts, and CSV.
              </p>
              <ul className="space-y-2 opacity-70">
                {archived.map((plunge, i) => row(plunge, i))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
