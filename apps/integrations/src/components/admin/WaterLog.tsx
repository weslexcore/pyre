// Cold-tub water testing log: staff enter readings for the Left/Right tubs,
// get chart-based dosing recommendations (computed locally via
// lib/water/recommendations — no network round-trip), and save entries with
// the doses actually added. Auth is handled server-side by AdminLayout; a
// 401/403 from the API mid-session renders a re-login prompt.
import { useCallback, useEffect, useState } from 'react';
import type { DoseRecord, WaterTestRow } from '@/lib/db';
import { type EntryType, SHOCK_DOSES, TARGETS, TUBS, type Tub } from '@/lib/water/charts';
import { INSTRUCTIONS } from '@/lib/water/instructions';
import {
  classifyReading,
  getRecommendations,
  type Readings,
  type Recommendation,
} from '@/lib/water/recommendations';

interface LogResponse {
  records: WaterTestRow[];
  total: number;
  limit: number;
  offset: number;
}

interface DoseDraft {
  chemical: string;
  gramsStr: string;
  reason?: string;
  recommendedGrams?: number;
  accepted: boolean;
}

const inputClass =
  'w-full px-3 py-3 rounded bg-white/5 border border-white/10 text-base text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const pillClass = (active: boolean) =>
  `px-3 py-2.5 rounded text-xs font-mono-bold uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

const READING_FIELDS = [
  { key: 'ta', label: 'Total Alkalinity', unit: 'ppm', column: 'ta_ppm' },
  { key: 'ph', label: 'pH', unit: '', column: 'ph' },
  { key: 'chlorine', label: 'Chlorine', unit: 'ppm', column: 'chlorine_ppm' },
  { key: 'salt', label: 'Salt', unit: 'ppm', column: 'salt_ppm' },
] as const;

type ReadingKey = (typeof READING_FIELDS)[number]['key'];

const targetHint = (key: ReadingKey) => `${TARGETS[key][0]}–${TARGETS[key][1]}`;

const ENTRY_TYPE_LABELS: Array<[EntryType, string]> = [
  ['test', 'Test'],
  ['shock', 'Shock'],
  ['refill', 'Drain / Refill'],
];

function TimeAgo({ iso }: { iso: string }) {
  const timestamp = Date.parse(iso);
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  let label: string;
  if (mins < 1) label = 'just now';
  else if (mins < 60) label = `${mins}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else label = `${days}d ago`;

  return <span title={new Date(timestamp).toLocaleString()}>{label}</span>;
}

const statusTint: Record<ReturnType<typeof classifyReading>, string> = {
  ok: 'text-[var(--pyre-creme)]',
  'out-of-target': 'text-[var(--pyre-gold)]',
  critical: 'text-[var(--pyre-red)]',
};

function ReadingChips({ record }: { record: WaterTestRow }) {
  const shown = READING_FIELDS.filter((f) => record[f.column] != null);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm">
      {shown.map((f) => {
        const value = record[f.column] as number;
        return (
          <span key={f.key} className="whitespace-nowrap">
            <span className="text-white/40">{f.key === 'ph' ? 'pH' : f.label}</span>{' '}
            <span className={statusTint[classifyReading(f.key, value)]}>
              {value}
              {f.unit ? ` ${f.unit}` : ''}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function InstructionsPanel({ entryType }: { entryType: keyof typeof INSTRUCTIONS }) {
  const instructions = INSTRUCTIONS[entryType];
  if (!instructions) return null;
  return (
    <details className="mb-4 rounded border border-[var(--pyre-blue)]/30 bg-[var(--pyre-blue)]/5">
      <summary className="cursor-pointer select-none px-3 py-2.5 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-blue)] hover:opacity-80">
        {instructions.title}
      </summary>
      <div className="space-y-3 px-3 pt-1 pb-3 text-sm text-white/70">
        {instructions.sections.map((section) => (
          <div key={section.heading ?? 'steps'}>
            {section.heading && (
              <div className="mb-1 font-mono-bold text-xs uppercase tracking-wide text-white/40">
                {section.heading}
              </div>
            )}
            <ol className="list-decimal space-y-1 pl-5">
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
        {instructions.footnote && <p className="text-xs text-white/40">{instructions.footnote}</p>}
      </div>
    </details>
  );
}

function parseReading(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined; // undefined = invalid input
}

export function WaterLog({ userEmail }: { userEmail: string }) {
  const [sessionExpired, setSessionExpired] = useState(false);

  // --- entry form ---
  const [tub, setTub] = useState<Tub>('left');
  const [entryType, setEntryType] = useState<EntryType>('test');
  const [readingInputs, setReadingInputs] = useState<Record<ReadingKey, string>>({
    ta: '',
    ph: '',
    chlorine: '',
    salt: '',
  });
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<'entering' | 'reviewing'>('entering');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [doseDrafts, setDoseDrafts] = useState<DoseDraft[]>([]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedReminder, setSavedReminder] = useState('');

  // --- log ---
  const [records, setRecords] = useState<WaterTestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'all' | Tub>('all');
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadLog = useCallback(async (offset: number, tubFilter: 'all' | Tub) => {
    setLogLoading(true);
    setLogError('');
    try {
      const params = new URLSearchParams({ limit: '25', offset: String(offset) });
      if (tubFilter !== 'all') params.set('tub', tubFilter);
      const res = await fetch(`/api/admin/water-tests?${params}`);
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LogResponse;
      setRecords((prev) => (offset === 0 ? data.records : [...prev, ...data.records]));
      setTotal(data.total);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to load log');
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLog(0, filter);
  }, [loadLog, filter]);

  const collectReadings = (): Readings | null => {
    const readings: Record<string, number | null> = {};
    for (const field of READING_FIELDS) {
      const parsed = parseReading(readingInputs[field.key]);
      if (parsed === undefined) {
        setFormError(`${field.label} must be a number (leave blank if not tested)`);
        return null;
      }
      readings[field.key] = parsed;
    }
    return readings as Readings;
  };

  const SHOCK_NOTE = 'Tub closed for shock. Cover off 20+ min, retest before reopening.';

  const switchEntryType = (type: EntryType) => {
    setEntryType(type);
    setPhase('entering');
    setRecommendations([]);
    setFormError('');
    if (type === 'shock') {
      setDoseDrafts(
        SHOCK_DOSES.map((d) => ({
          chemical: d.chemical,
          gramsStr: String(d.grams),
          recommendedGrams: d.grams,
          reason: 'Weekly shock treatment',
          accepted: true,
        }))
      );
      setNotes((prev) => prev.trim() || SHOCK_NOTE);
    } else {
      setDoseDrafts([]);
      // Drop the prefilled shock note when leaving shock, but never notes the
      // employee typed themselves.
      setNotes((prev) => (prev === SHOCK_NOTE ? '' : prev));
    }
  };

  const checkReadings = () => {
    setFormError('');
    const readings = collectReadings();
    if (!readings) return;
    if (Object.values(readings).every((v) => v == null)) {
      setFormError('Enter at least one reading');
      return;
    }
    const recs = getRecommendations(readings);
    setRecommendations(recs);
    setDoseDrafts(
      recs
        .filter((r) => r.severity === 'action' && r.chemical && r.grams != null)
        .map((r) => ({
          chemical: r.chemical as string,
          gramsStr: String(r.grams),
          reason: r.reason,
          recommendedGrams: r.grams as number,
          accepted: true,
        }))
    );
    setPhase('reviewing');
  };

  const save = async () => {
    setFormError('');
    const readings = collectReadings();
    if (!readings) return;

    const doses: DoseRecord[] = [];
    for (const draft of doseDrafts) {
      if (!draft.accepted) continue;
      const grams = Number(draft.gramsStr);
      if (!Number.isFinite(grams) || grams <= 0) {
        setFormError(`${draft.chemical}: grams must be a positive number`);
        return;
      }
      doses.push({
        chemical: draft.chemical,
        grams,
        reason: draft.reason,
        recommended_grams: draft.recommendedGrams,
      });
    }

    // Fold hard-limit instructions into the saved notes so the log reads
    // complete without re-deriving them.
    const criticalNotes = recommendations
      .filter((r) => r.severity === 'critical' && r.instruction)
      .map((r) => r.instruction as string);
    const fullNotes = [notes.trim(), ...criticalNotes].filter(Boolean).join(' ');

    setSaving(true);
    try {
      const res = await fetch('/api/admin/water-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tub, entryType, readings, doses, notes: fullNotes }),
      });
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        return;
      }
      const data = (await res.json()) as { record?: WaterTestRow; error?: string };
      if (!res.ok || !data.record) throw new Error(data.error || `HTTP ${res.status}`);

      if (filter === 'all' || filter === tub) {
        setRecords((prev) => [data.record as WaterTestRow, ...prev]);
        setTotal((prev) => prev + 1);
      }
      setSavedReminder(
        doses.length > 0
          ? 'Saved. Run pumps ~15 minutes, then retest and log the new readings.'
          : 'Saved.'
      );
      setReadingInputs({ ta: '', ph: '', chlorine: '', salt: '' });
      setNotes('');
      setRecommendations([]);
      setDoseDrafts([]);
      setEntryType('test');
      setPhase('entering');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (record: WaterTestRow) => {
    if (!window.confirm(`Delete this ${record.tub} tub entry? This can't be undone.`)) return;
    setDeletingId(record.id);
    setLogError('');
    try {
      const res = await fetch(`/api/admin/water-tests?id=${encodeURIComponent(record.id)}`, {
        method: 'DELETE',
      });
      if (res.status === 401) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to delete entry');
    } finally {
      setDeletingId(null);
    }
  };

  if (sessionExpired) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h2 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
          Session expired
        </h2>
        <p className="text-white/60 mb-6">Log in again to continue.</p>
        <a
          href="/api/auth/login?returnUrl=%2Fadmin%2Fwater"
          className="inline-block px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
        >
          Log In
        </a>
      </div>
    );
  }

  const criticals = recommendations.filter((r) => r.severity === 'critical');
  const infos = recommendations.filter((r) => r.severity === 'info');
  const reviewing = phase === 'reviewing';

  return (
    <div className="max-w-2xl mx-auto">
      {/* ---- Entry form ---- */}
      <div className="mb-10 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-mono-bold uppercase tracking-wide text-white/40">
            Tub
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TUBS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTub(value)}
                disabled={reviewing}
                className={pillClass(tub === value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-xs font-mono-bold uppercase tracking-wide text-white/40">
            Entry type
          </div>
          <div className="grid grid-cols-3 gap-2">
            {ENTRY_TYPE_LABELS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchEntryType(value)}
                disabled={reviewing}
                className={pillClass(entryType === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {entryType !== 'test' && <InstructionsPanel entryType={entryType} />}

        <div className="mb-4 grid grid-cols-2 gap-3">
          {READING_FIELDS.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1.5 block text-xs font-mono-bold uppercase tracking-wide text-white/40">
                {field.label}
                {field.unit ? ` (${field.unit})` : ''}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={readingInputs[field.key]}
                onChange={(e) =>
                  setReadingInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                disabled={reviewing}
                placeholder={targetHint(field.key)}
                className={inputClass}
              />
            </label>
          ))}
        </div>
        {entryType === 'test' && !reviewing && (
          <p className="mb-4 -mt-2 font-mono text-xs text-white/30">
            Blank = not tested. Targets shown in each field.
          </p>
        )}

        {/* Review panel */}
        {reviewing && (
          <div className="mb-4">
            {criticals.map((rec) => (
              <div
                key={rec.parameter}
                className="mb-3 rounded border border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 p-3"
              >
                <div className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-red)]">
                  {rec.instruction}
                </div>
                <div className="mt-1 text-sm text-white/70">{rec.reason}</div>
              </div>
            ))}

            {doseDrafts.length === 0 && criticals.length === 0 && (
              <div className="mb-3 rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 p-3 text-sm text-[var(--pyre-sage)]">
                All readings in range — nothing to add.
              </div>
            )}

            {doseDrafts.map((draft, index) => (
              <div
                key={draft.chemical}
                className={`mb-3 rounded border p-3 ${
                  draft.accepted ? 'border-white/20 bg-white/5' : 'border-white/10 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-primary-semibold text-sm">{draft.chemical}</div>
                  <button
                    type="button"
                    onClick={() =>
                      setDoseDrafts((prev) =>
                        prev.map((d, i) => (i === index ? { ...d, accepted: !d.accepted } : d))
                      )
                    }
                    className={pillClass(draft.accepted)}
                  >
                    {draft.accepted ? 'Adding' : 'Skipped'}
                  </button>
                </div>
                {draft.reason && <div className="mt-1 text-sm text-white/60">{draft.reason}</div>}
                {draft.accepted && (
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft.gramsStr}
                      onChange={(e) =>
                        setDoseDrafts((prev) =>
                          prev.map((d, i) => (i === index ? { ...d, gramsStr: e.target.value } : d))
                        )
                      }
                      className={`${inputClass} max-w-28`}
                    />
                    <span className="font-mono text-sm text-white/40">
                      g{' '}
                      {Number(draft.gramsStr) !== draft.recommendedGrams &&
                        `(chart: ${draft.recommendedGrams} g)`}
                    </span>
                  </label>
                )}
              </div>
            ))}

            {infos.map((rec) => (
              <div
                key={rec.parameter}
                className="mb-3 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 p-3 text-sm text-white/70"
              >
                {rec.reason}
              </div>
            ))}
          </div>
        )}

        {/* Shock/refill dose list (single-phase) */}
        {!reviewing && entryType === 'shock' && (
          <div className="mb-4">
            {doseDrafts.map((draft, index) => (
              <div
                key={draft.chemical}
                className="mb-2 flex items-center gap-3 rounded border border-white/10 bg-white/5 p-3"
              >
                <div className="flex-1 font-primary-semibold text-sm">{draft.chemical}</div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.gramsStr}
                  onChange={(e) =>
                    setDoseDrafts((prev) =>
                      prev.map((d, i) => (i === index ? { ...d, gramsStr: e.target.value } : d))
                    )
                  }
                  className={`${inputClass} max-w-24`}
                />
                <span className="font-mono text-sm text-white/40">g</span>
              </div>
            ))}
          </div>
        )}

        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-mono-bold uppercase tracking-wide text-white/40">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional"
            className={inputClass}
          />
        </label>

        {formError && <p className="mb-3 text-sm text-[var(--pyre-red)]">{formError}</p>}
        {savedReminder && !reviewing && (
          <p className="mb-3 rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 p-3 text-sm text-[var(--pyre-sage)]">
            {savedReminder}
          </p>
        )}

        <div className="flex gap-2">
          {entryType === 'test' && !reviewing ? (
            <button
              type="button"
              onClick={() => {
                setSavedReminder('');
                checkReadings();
              }}
              className="flex-1 rounded-md bg-[var(--pyre-red)] px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90"
            >
              Check readings
            </button>
          ) : (
            <>
              {reviewing && (
                <button
                  type="button"
                  onClick={() => setPhase('entering')}
                  disabled={saving}
                  className="rounded-md border border-white/20 px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSavedReminder('');
                  void save();
                }}
                disabled={saving}
                className="flex-1 rounded-md bg-[var(--pyre-red)] px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save entry'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ---- Log ---- */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-primary-semibold text-lg">Log</h2>
        <div className="flex gap-2">
          {(['all', ...TUBS] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={pillClass(filter === value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {logError && <p className="mb-3 text-sm text-[var(--pyre-red)]">{logError}</p>}
      {!logError && records.length === 0 && !logLoading && (
        <p className="text-sm text-white/40">No entries yet.</p>
      )}

      {records.map((record) => (
        <div key={record.id} className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded bg-white/10 px-2 py-0.5 font-mono-bold text-xs uppercase tracking-wide">
              {record.tub}
            </span>
            {record.entry_type !== 'test' && (
              <span className="rounded bg-[var(--pyre-blue)]/20 px-2 py-0.5 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-blue)]">
                {record.entry_type}
              </span>
            )}
            <span className="ml-auto font-mono text-xs text-white/40">
              <TimeAgo iso={record.created_at} />
            </span>
          </div>

          <ReadingChips record={record} />

          {record.doses.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {record.doses.map((dose) => (
                <div
                  key={`${record.id}-${dose.chemical}`}
                  className="font-mono text-sm text-white/70"
                >
                  ＋ {dose.chemical} {dose.grams} g
                  {dose.recommended_grams != null && dose.recommended_grams !== dose.grams && (
                    <span className="text-[var(--pyre-gold)]">
                      {' '}
                      (chart: {dose.recommended_grams} g)
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {record.notes && <div className="mt-2 text-sm text-white/50">{record.notes}</div>}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-white/30">{record.recorded_by}</span>
            {record.recorded_by.toLowerCase() === userEmail.toLowerCase() && (
              <button
                type="button"
                onClick={() => void deleteEntry(record)}
                disabled={deletingId === record.id}
                className="font-mono text-xs uppercase tracking-wide text-white/30 transition-colors hover:text-[var(--pyre-red)] disabled:opacity-50"
              >
                {deletingId === record.id ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      ))}

      {records.length < total && (
        <button
          type="button"
          onClick={() => void loadLog(records.length, filter)}
          disabled={logLoading}
          className="w-full rounded-md border border-white/20 px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white disabled:opacity-50"
        >
          {logLoading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
