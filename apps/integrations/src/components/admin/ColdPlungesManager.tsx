// The cold plunge list (/admin/water/plunges), for admins.
//
// Each plunge has a name and the gallons it holds — the water log sizes every
// recommended dose from that volume (the manual's charts are written for a
// 120 gal tub). Each can also set its own weekly shock oxidizer amount in
// place of the scaled one. Plunges can be renamed, resized, re-ordered, and
// archived.
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
import { useCachedJson } from '@/lib/client/cachedJson';
import { optimistic, tempId } from '@/lib/client/optimistic';
import type { ColdPlungeRow } from '@/lib/db';
import { CHART_GALLONS, PRODUCTS, shockDoses } from '@/lib/water/charts';
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
  /** Blank uses the chart amount scaled to the gallons. */
  shockGrams: string;
}

const draftFor = (plunge: ColdPlungeRow): Draft => ({
  name: plunge.name,
  gallons: formatGallons(plunge.gallons),
  shockGrams: plunge.shock_oxidizer_grams == null ? '' : String(plunge.shock_oxidizer_grams),
});

/** Grams of oxidizer for a shock: the plunge's own amount, or the scaled one. */
const oxidizerGrams = (gallons: number, own?: number | null): number | undefined =>
  shockDoses(gallons, own).find((d) => d.chemical === PRODUCTS.oxidizer)?.grams;

/** The scaled default for the gallons being typed, for the field's placeholder. */
const defaultShockGrams = (gallonsInput: string): string => {
  const gallons = Number(gallonsInput);
  const grams = oxidizerGrams(gallons > 0 ? gallons : CHART_GALLONS);
  return grams == null ? '' : String(grams);
};

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
  const [draft, setDraft] = useState<Draft>({ name: '', gallons: '', shockGrams: '' });
  const [newPlunge, setNewPlunge] = useState({ name: '', gallons: String(CHART_GALLONS) });

  // Every change lands in the list at once and the request goes out behind
  // it; a refusal puts the list back and says why. The list is written
  // through to the cache under the same URL the water log reads, so it picks
  // up new names and volumes without a refetch of its own.
  const run = async <R,>(
    key: string,
    update: (plunges: ColdPlungeRow[]) => ColdPlungeRow[],
    action: () => Promise<R>,
    reconcile?: (plunges: ColdPlungeRow[], result: R) => ColdPlungeRow[]
  ): Promise<boolean> => {
    setBusy(key);
    setMessage(null);
    const result = await optimistic(
      setData,
      (prev) => (prev ? { ...prev, plunges: update(prev.plunges) } : prev),
      action,
      {
        reconcile: reconcile
          ? (prev, value) => (prev ? { ...prev, plunges: reconcile(prev.plunges, value) } : prev)
          : undefined,
        onError: (text, e) => {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setExpired(true);
          setMessage(text);
        },
      }
    );
    setBusy(null);
    return result !== null;
  };

  const add = async () => {
    const pending = tempId();
    const name = newPlunge.name;
    const gallons = Number(newPlunge.gallons);
    setNewPlunge({ name: '', gallons: String(CHART_GALLONS) });
    const ok = await run(
      'add',
      (list) => [
        ...list,
        {
          id: pending,
          name: name.trim(),
          gallons: Number.isFinite(gallons) && gallons > 0 ? gallons : CHART_GALLONS,
          shock_oxidizer_grams: null,
          archived: false,
          sort_order: list.length,
        } as ColdPlungeRow,
      ],
      () =>
        sendJson<{ plunge: ColdPlungeRow }>(PLUNGES_URL, 'POST', {
          name,
          gallons: newPlunge.gallons,
        }),
      (list, { plunge }) => list.map((p) => (p.id === pending ? plunge : p))
    );
    // A refused add hands the form back what was typed.
    if (!ok) setNewPlunge({ name, gallons: newPlunge.gallons });
  };

  const patchPlunge = (
    plunge: ColdPlungeRow,
    body: Record<string, unknown>,
    next: Partial<ColdPlungeRow>
  ) =>
    run(
      plunge.id,
      (list) => list.map((p) => (p.id === plunge.id ? { ...p, ...next } : p)),
      () => sendJson<{ plunge: ColdPlungeRow }>(PLUNGES_URL, 'PATCH', { id: plunge.id, ...body }),
      (list, { plunge: saved }) => list.map((p) => (p.id === plunge.id ? saved : p))
    );

  const saveEdit = async (plunge: ColdPlungeRow) => {
    setEditingId(null);
    const shock = draft.shockGrams.trim();
    const gallons = Number(draft.gallons);
    const ok = await patchPlunge(
      plunge,
      {
        name: draft.name,
        gallons: draft.gallons,
        shock_oxidizer_grams: shock || null,
      },
      {
        name: draft.name.trim(),
        gallons: Number.isFinite(gallons) && gallons > 0 ? gallons : plunge.gallons,
        shock_oxidizer_grams: shock ? Number(shock) : null,
      }
    );
    // Refused: reopen the editor with what was typed, so nothing is lost.
    if (!ok) setEditingId(plunge.id);
  };

  const setArchived = (plunge: ColdPlungeRow, value: boolean) =>
    patchPlunge(plunge, { archived: value }, { archived: value });

  const move = (plunge: ColdPlungeRow, by: -1 | 1) => {
    const ids = active.map((p) => p.id);
    const from = ids.indexOf(plunge.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    // Archived plunges keep their place after the active ones.
    const order = [...ids, ...archived.map((p) => p.id)];
    const rank = new Map(order.map((id, index) => [id, index]));
    void run(
      plunge.id,
      (list) => [...list].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
      () => sendJson<{ plunges: ColdPlungeRow[] }>(PLUNGES_URL, 'PATCH', { order }),
      (_list, result) => result.plunges
    );
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
    await run(
      plunge.id,
      (list) => list.filter((p) => p.id !== plunge.id),
      () => sendJson(`${PLUNGES_URL}?id=${encodeURIComponent(plunge.id)}`, 'DELETE')
    );
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
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem]">
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
            <label>
              <span className={labelClass}>Shock oxidizer (g)</span>
              <input
                value={draft.shockGrams}
                inputMode="decimal"
                placeholder={defaultShockGrams(draft.gallons)}
                onChange={(e) => setDraft((d) => ({ ...d, shockGrams: e.target.value }))}
                className={`${inputClass} w-full`}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-white/40">
            Leave the shock oxidizer blank to use the chart amount sized for the gallons. Changes
            apply to doses recommended from now on. Entries already logged keep the amounts that
            were added.
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
            {formatGallons(plunge.gallons)} gal · shock{' '}
            {oxidizerGrams(plunge.gallons, plunge.shock_oxidizer_grams)} g oxidizer
            {plunge.shock_oxidizer_grams == null ? '' : ' (custom)'} · {count} log{' '}
            {count === 1 ? 'entry' : 'entries'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!plunge.archived && (
            <>
              <button
                type="button"
                aria-label={`Move ${plunge.name} up`}
                onClick={() => move(plunge, -1)}
                disabled={rowBusy || index === 0}
                className={buttonClass}
              >
                Up
              </button>
              <button
                type="button"
                aria-label={`Move ${plunge.name} down`}
                onClick={() => move(plunge, 1)}
                disabled={rowBusy || index === active.length - 1}
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
                disabled={rowBusy}
                className={buttonClass}
              >
                Edit
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void setArchived(plunge, !plunge.archived)}
            disabled={rowBusy}
            className={buttonClass}
          >
            {plunge.archived ? 'Restore' : 'Archive'}
          </button>
          {count === 0 && (
            <button
              type="button"
              onClick={() => void remove(plunge)}
              disabled={rowBusy}
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
                disabled={busy === 'add' || !newPlunge.name.trim()}
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
