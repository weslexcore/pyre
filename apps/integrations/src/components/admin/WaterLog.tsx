// Cold-tub water testing log: staff enter readings for the Left/Right tubs,
// get chart-based dosing recommendations (computed locally via
// lib/water/recommendations — no network round-trip), and save entries with
// the doses actually added. Feedback is live: each reading field tints and
// shows its recommendation as soon as a value is typed, before "Check
// readings" opens the review step. Auth is handled server-side by
// AdminLayout; a 401/403 from the API mid-session renders a re-login prompt.
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { DoseRecord, WaterTestRow } from '@/lib/db';
import {
  DEFAULT_TEST_METHOD,
  type EntryType,
  type Parameter,
  SHOCK_DOSES,
  TARGETS,
  TEST_METHOD_LABELS,
  TEST_METHODS,
  type TestMethod,
  TUBS,
  type Tub,
} from '@/lib/water/charts';
import { INSTRUCTIONS } from '@/lib/water/instructions';
import {
  classifyReading,
  getGuestSafety,
  getRecommendations,
  type ReadingStatus,
  type Readings,
  type Recommendation,
} from '@/lib/water/recommendations';
import { MeasurementInfoButton } from './MeasurementInfo';
import { WaterTrends } from './WaterTrends';

const RANGES = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: 'all', label: 'All', days: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

const sinceIso = (rangeKey: RangeKey): string | null => {
  const days = RANGES.find((r) => r.key === rangeKey)?.days ?? null;
  return days == null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
};

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
  /** Operator rule that travels with the dose (e.g. TA before pH). */
  instruction?: string;
  recommendedGrams?: number;
  accepted: boolean;
}

const inputClass =
  'w-full px-3 py-3 rounded bg-white/5 border border-white/10 text-base text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

// Reading inputs tint their border by live status so a problem value is
// visible the moment it's typed. Border color is baked into one string per
// state (rather than appended to inputClass) so two border-color utilities
// never compete on the same element.
const inputBase =
  'w-full px-3 py-3 rounded bg-white/5 border text-base text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none';

// `blocked` is a reading the operator must not act on yet (pH while TA is
// off); it borrows the red border so the field itself reads as "stop", not as
// the ordinary gold "out of target, dose it".
const readingInputClass = (
  status: ReadingStatus | null,
  invalid: boolean,
  blocked = false
): string => {
  if (invalid || blocked || status === 'critical')
    return `${inputBase} border-[var(--pyre-red)] focus:border-[var(--pyre-red)]`;
  if (status === 'out-of-target')
    return `${inputBase} border-[var(--pyre-gold)]/70 focus:border-[var(--pyre-gold)]`;
  if (status === 'ok')
    return `${inputBase} border-[var(--pyre-sage)]/60 focus:border-[var(--pyre-sage)]`;
  return `${inputBase} border-white/10 focus:border-white/30`;
};

const pillClass = (active: boolean) =>
  `px-3 py-2.5 rounded text-xs font-mono-bold uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

const READING_FIELDS = [
  { key: 'ta', label: 'Total Alkalinity', chip: 'TA', unit: 'ppm', column: 'ta_ppm' },
  { key: 'ph', label: 'pH', chip: 'pH', unit: '', column: 'ph' },
  {
    key: 'chlorine',
    label: 'Free Chlorine (FC)',
    chip: 'FC',
    unit: 'ppm',
    column: 'free_chlorine_ppm',
  },
  {
    key: 'cc',
    label: 'Combined Chlorine (CC)',
    chip: 'CC',
    unit: 'ppm',
    column: 'combined_chlorine_ppm',
  },
  { key: 'salt', label: 'Salt', chip: 'Salt', unit: 'ppm', column: 'salt_ppm' },
] as const;

type ReadingKey = (typeof READING_FIELDS)[number]['key'];

const targetHint = (key: ReadingKey) => `${TARGETS[key][0]}–${TARGETS[key][1]}`;

// Saved row → engine input, so a logged entry is judged by exactly the rules
// the entry form applied when it was taken.
const recordReadings = (record: WaterTestRow): Readings => ({
  ta: record.ta_ppm,
  ph: record.ph,
  chlorine: record.free_chlorine_ppm,
  cc: record.combined_chlorine_ppm,
  salt: record.salt_ppm,
});

const ENTRY_TYPE_LABELS: Array<[EntryType, string]> = [
  ['test', 'Test'],
  ['shock', 'Shock'],
  ['refill', 'Drain / Refill'],
];

type TypeFilter = 'all' | EntryType;

// Log filter options: same three types the form writes, plus "all".
const ENTRY_TYPE_FILTERS: Array<[TypeFilter, string]> = [
  ['all', 'All types'],
  ...ENTRY_TYPE_LABELS,
];

// Staff read the log to answer "when was this tub last tested?", so entries
// carry the clock time they were taken rather than an elapsed-time marker.
// Rendered in the viewer's locale/timezone, which differs from the server's on
// first paint — hence suppressHydrationWarning.
const TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

function RecordedAt({ iso }: { iso: string }) {
  const timestamp = new Date(iso);
  return (
    <span suppressHydrationWarning title={timestamp.toLocaleString()}>
      {timestamp.toLocaleString(undefined, TIMESTAMP_FORMAT)}
    </span>
  );
}

const statusTint: Record<ReturnType<typeof classifyReading>, string> = {
  ok: 'text-[var(--pyre-creme)]',
  'out-of-target': 'text-[var(--pyre-gold)]',
  critical: 'text-[var(--pyre-red)]',
};

function ReadingChips({
  record,
  infoParam,
  onInfoChange,
}: {
  record: WaterTestRow;
  infoParam: Parameter | null;
  onInfoChange: (parameter: Parameter | null) => void;
}) {
  const shown = READING_FIELDS.filter((f) => record[f.column] != null);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm">
      {shown.map((f) => {
        const value = record[f.column] as number;
        return (
          <span key={f.key} className="whitespace-nowrap">
            <span className="text-white/40">{f.chip}</span>{' '}
            <span className={statusTint[classifyReading(f.key, value)]}>
              {value}
              {f.unit ? ` ${f.unit}` : ''}
            </span>
            <MeasurementInfoButton
              parameter={f.key}
              open={infoParam === f.key}
              onOpenChange={(open) => onInfoChange(open ? f.key : null)}
              className="ml-1"
            />
          </span>
        );
      })}
    </div>
  );
}

// A rule the operator must not skip past (close the tub, fix TA before pH),
// shown in red under the field it applies to.
function InstructionLine({ text }: { text: string }) {
  return (
    <span className="mt-0.5 block font-mono-bold uppercase tracking-wide text-[var(--pyre-red)]">
      {text}
    </span>
  );
}

// Inline feedback under a reading input, shown as soon as the value parses.
// Mirrors the review panel's severity styling at note scale: criticals and
// blocked readings lead with the rule, actions with the dose to add.
function LiveFieldNote({
  rec,
  status,
  invalid,
}: {
  rec: Recommendation | undefined;
  status: ReadingStatus | null;
  invalid: boolean;
}) {
  let content: ReactNode = null;
  if (invalid) {
    content = (
      <span className="text-[var(--pyre-red)]">Not a number — leave blank if not tested.</span>
    );
  } else if (rec?.severity === 'critical' || rec?.severity === 'blocked') {
    content = (
      <span className="text-[var(--pyre-red)]">
        <span className="font-mono-bold uppercase tracking-wide">{rec.instruction}</span>{' '}
        <span className="text-white/60">{rec.reason}</span>
      </span>
    );
  } else if (rec?.severity === 'action' && rec.chemical && rec.grams != null) {
    content = (
      <>
        <span className="text-[var(--pyre-gold)]">
          <span className="font-mono-bold">
            Add {rec.grams} g {rec.chemical}
          </span>{' '}
          <span className="text-white/60">— {rec.reason}</span>
        </span>
        {rec.instruction && <InstructionLine text={rec.instruction} />}
      </>
    );
  } else if (rec) {
    content = (
      <>
        <span className="text-white/60">{rec.reason}</span>
        {rec.instruction && <InstructionLine text={rec.instruction} />}
      </>
    );
  } else if (status === 'ok') {
    content = <span className="text-[var(--pyre-sage)]">✓ In range</span>;
  }

  // Always render the (aria-live) container so screen readers announce notes
  // as they appear.
  return (
    <span aria-live="polite" className="mt-1 block text-xs leading-snug">
      {content}
    </span>
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

/**
 * In-place editor for an entry already in the log — the salt reading taken
 * after the entry was saved, the dose logged at the wrong weight, the note
 * that needed another sentence. Tub and entry type are not editable: changing
 * those would make the row a different event, and the log is an audit record.
 *
 * It carries the same live recommendations as the entry form, so a reading
 * added late is judged by the same rules — including TA gating pH — and any
 * dose those corrected readings now call for can be logged onto the entry
 * instead of being stranded.
 */
function EditEntryPanel({
  record,
  infoParam,
  onInfoChange,
  onCancel,
  onSaved,
  onSessionExpired,
}: {
  record: WaterTestRow;
  infoParam: Parameter | null;
  onInfoChange: (parameter: Parameter | null) => void;
  onCancel: () => void;
  onSaved: (record: WaterTestRow) => void;
  onSessionExpired: () => void;
}) {
  // Drain/refill rows carry no measurements by design, so there is nothing to
  // correct on one but its doses and notes.
  const hasReadings = record.entry_type !== 'refill';

  const [readingInputs, setReadingInputs] = useState<Record<ReadingKey, string>>(() => {
    const initial = {} as Record<ReadingKey, string>;
    for (const field of READING_FIELDS) {
      const value = record[field.column];
      initial[field.key] = value == null ? '' : String(value);
    }
    return initial;
  });
  const [testMethod, setTestMethod] = useState<TestMethod>(
    record.test_method ?? DEFAULT_TEST_METHOD
  );
  const [doseDrafts, setDoseDrafts] = useState<DoseDraft[]>(() =>
    record.doses.map((dose) => ({
      chemical: dose.chemical,
      gramsStr: String(dose.grams),
      reason: dose.reason,
      recommendedGrams: dose.recommended_grams,
      accepted: true,
    }))
  );
  const [notes, setNotes] = useState(record.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const liveReadings = useMemo<Readings>(() => {
    const readings: Record<string, number | null> = {};
    for (const field of READING_FIELDS) {
      const parsed = parseReading(readingInputs[field.key]);
      readings[field.key] = parsed === undefined ? null : parsed;
    }
    return readings as Readings;
  }, [readingInputs]);

  const recommendations = useMemo(() => getRecommendations(liveReadings), [liveReadings]);

  const liveRecByParam = useMemo(() => {
    const map = new Map<ReadingKey, Recommendation>();
    for (const rec of recommendations) map.set(rec.parameter, rec);
    return map;
  }, [recommendations]);

  // Doses the corrected readings now call for that aren't on the entry yet.
  const unlogged = recommendations.filter(
    (rec) =>
      rec.severity === 'action' &&
      rec.chemical &&
      rec.grams != null &&
      !doseDrafts.some((draft) => draft.chemical === rec.chemical)
  );

  const save = async () => {
    setError('');
    const body: Record<string, unknown> = {};

    if (hasReadings) {
      const readings: Record<string, number | null> = {};
      for (const field of READING_FIELDS) {
        const parsed = parseReading(readingInputs[field.key]);
        if (parsed === undefined) {
          setError(`${field.label} must be a number (leave blank if not tested)`);
          return;
        }
        readings[field.key] = parsed;
      }
      const measured = Object.values(readings).some((v) => v != null);
      if (record.entry_type === 'test' && !measured) {
        setError('A test entry needs at least one reading');
        return;
      }
      body.readings = readings;
      body.testMethod = measured ? testMethod : null;
    }

    const doses: DoseRecord[] = [];
    for (const draft of doseDrafts) {
      if (!draft.accepted) continue;
      const grams = Number(draft.gramsStr);
      if (!Number.isFinite(grams) || grams <= 0) {
        setError(`${draft.chemical}: grams must be a positive number`);
        return;
      }
      doses.push({
        chemical: draft.chemical,
        grams,
        reason: draft.reason,
        recommended_grams: draft.recommendedGrams,
      });
    }
    body.doses = doses;
    body.notes = notes.trim();

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/water-tests?id=${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = (await res.json()) as { record?: WaterTestRow; error?: string };
      if (!res.ok || !data.record) throw new Error(data.error || `HTTP ${res.status}`);
      onSaved(data.record);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded border border-white/20 bg-white/5 p-3">
      <div className="mb-3 font-mono-bold text-xs uppercase tracking-wide text-white/40">
        Editing this entry
      </div>

      {hasReadings && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          {READING_FIELDS.map((field) => {
            const parsed = parseReading(readingInputs[field.key]);
            const invalid = parsed === undefined;
            const status = typeof parsed === 'number' ? classifyReading(field.key, parsed) : null;
            const rec = typeof parsed === 'number' ? liveRecByParam.get(field.key) : undefined;
            return (
              <label key={field.key} className="block">
                <span className="mb-1.5 flex items-center gap-1 text-xs font-mono-bold uppercase tracking-wide text-white/40">
                  <span>
                    {field.label}
                    {field.unit ? ` (${field.unit})` : ''}
                  </span>
                  <MeasurementInfoButton
                    parameter={field.key}
                    open={infoParam === field.key}
                    onOpenChange={(open) => onInfoChange(open ? field.key : null)}
                  />
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={readingInputs[field.key]}
                  onChange={(e) =>
                    setReadingInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={targetHint(field.key)}
                  className={readingInputClass(status, invalid, rec?.severity === 'blocked')}
                />
                <LiveFieldNote rec={rec} status={status} invalid={invalid} />
              </label>
            );
          })}
          <label className="block">
            <span className="mb-1.5 block text-xs font-mono-bold uppercase tracking-wide text-white/40">
              Test method
            </span>
            <select
              value={testMethod}
              onChange={(e) => setTestMethod(e.target.value as TestMethod)}
              className={inputClass}
            >
              {TEST_METHODS.map((method) => (
                <option key={method} value={method}>
                  {TEST_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {doseDrafts.map((draft, index) => (
        <div
          key={draft.chemical}
          className={`mb-2 rounded border p-3 ${
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
              {draft.accepted ? 'Logged' : 'Removed'}
            </button>
          </div>
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
                {draft.recommendedGrams != null &&
                  Number(draft.gramsStr) !== draft.recommendedGrams &&
                  `(chart: ${draft.recommendedGrams} g)`}
              </span>
            </label>
          )}
        </div>
      ))}

      {unlogged.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-xs text-white/40">
            These readings call for a dose that isn't on the entry:
          </div>
          <div className="flex flex-wrap gap-2">
            {unlogged.map((rec) => (
              <button
                key={rec.parameter}
                type="button"
                onClick={() =>
                  setDoseDrafts((prev) => [
                    ...prev,
                    {
                      chemical: rec.chemical as string,
                      gramsStr: String(rec.grams),
                      reason: rec.reason,
                      recommendedGrams: rec.grams as number,
                      accepted: true,
                    },
                  ])
                }
                className="rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-gold)] transition-colors hover:border-[var(--pyre-gold)]"
              >
                ＋ {rec.grams} g {rec.chemical}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="mb-3 block">
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

      {error && <p className="mb-2 text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-white/20 px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex-1 rounded-md bg-[var(--pyre-red)] px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
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
    cc: '',
    salt: '',
  });
  const [testMethod, setTestMethod] = useState<TestMethod>(DEFAULT_TEST_METHOD);
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // One info modal at a time across the whole page — the log renders a ⓘ per
  // reading per entry, and two open dialogs would be nonsense.
  const [infoParam, setInfoParam] = useState<Parameter | null>(null);

  // --- trends chart ---
  const [range, setRange] = useState<RangeKey>('30d');
  const [chartRecords, setChartRecords] = useState<WaterTestRow[]>([]);

  const loadLog = useCallback(
    async (
      offset: number,
      tubFilter: 'all' | Tub,
      rangeKey: RangeKey,
      entryTypeFilter: TypeFilter
    ) => {
      setLogLoading(true);
      setLogError('');
      try {
        const params = new URLSearchParams({ limit: '25', offset: String(offset) });
        if (tubFilter !== 'all') params.set('tub', tubFilter);
        if (entryTypeFilter !== 'all') params.set('entryType', entryTypeFilter);
        const since = sinceIso(rangeKey);
        if (since) params.set('since', since);
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
    },
    []
  );

  // The chart wants the whole window in one fetch (up to the API's 100-row
  // cap), not the log's 25-row pages.
  const loadChart = useCallback(
    async (tubFilter: 'all' | Tub, rangeKey: RangeKey, entryTypeFilter: TypeFilter) => {
      try {
        const params = new URLSearchParams({ limit: '100' });
        if (tubFilter !== 'all') params.set('tub', tubFilter);
        if (entryTypeFilter !== 'all') params.set('entryType', entryTypeFilter);
        const since = sinceIso(rangeKey);
        if (since) params.set('since', since);
        const res = await fetch(`/api/admin/water-tests?${params}`);
        if (!res.ok) return; // the log surfaces fetch problems; the chart stays quiet
        const data = (await res.json()) as LogResponse;
        setChartRecords(data.records);
      } catch {
        // ignore — chart is supplementary
      }
    },
    []
  );

  useEffect(() => {
    void loadLog(0, filter, range, typeFilter);
    void loadChart(filter, range, typeFilter);
  }, [loadLog, loadChart, filter, range, typeFilter]);

  // Live per-field feedback: the recommendation engine is pure and local, so
  // rerunning it on every keystroke is free. Invalid text is treated as
  // not-tested here (the field flags it inline); recommendations compose
  // across fields (e.g. pH advice knows whether a TA dose is also pending).
  const liveReadings = useMemo<Readings>(() => {
    const readings: Record<string, number | null> = {};
    for (const field of READING_FIELDS) {
      const parsed = parseReading(readingInputs[field.key]);
      readings[field.key] = parsed === undefined ? null : parsed;
    }
    return readings as Readings;
  }, [readingInputs]);

  const liveRecByParam = useMemo(() => {
    const map = new Map<ReadingKey, Recommendation>();
    for (const rec of getRecommendations(liveReadings)) map.set(rec.parameter, rec);
    return map;
  }, [liveReadings]);

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
          instruction: r.instruction,
          recommendedGrams: r.grams as number,
          accepted: true,
        }))
    );
    setPhase('reviewing');
  };

  const save = async () => {
    setFormError('');
    // Drain/refill entries record the water change only — tests are logged
    // separately. Ignore any reading inputs typed before switching type.
    const readings =
      entryType === 'refill'
        ? ({ ta: null, ph: null, chlorine: null, cc: null, salt: null } as Readings)
        : collectReadings();
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
        body: JSON.stringify({
          tub,
          entryType,
          readings,
          // Only meaningful when something was actually measured.
          testMethod: Object.values(readings).some((v) => v != null) ? testMethod : null,
          doses,
          notes: fullNotes,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        return;
      }
      const data = (await res.json()) as { record?: WaterTestRow; error?: string };
      if (!res.ok || !data.record) throw new Error(data.error || `HTTP ${res.status}`);

      if (
        (filter === 'all' || filter === tub) &&
        (typeFilter === 'all' || typeFilter === entryType)
      ) {
        setRecords((prev) => [data.record as WaterTestRow, ...prev]);
        setTotal((prev) => prev + 1);
        setChartRecords((prev) => [data.record as WaterTestRow, ...prev]);
      }
      setSavedReminder(
        doses.length > 0
          ? 'Saved. Run pumps ~15 minutes, then retest and log the new readings.'
          : 'Saved.'
      );
      setReadingInputs({ ta: '', ph: '', chlorine: '', cc: '', salt: '' });
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

  // CSV of everything matching the current range/tub filters — not just the
  // pages loaded below. Fetched rather than linked so an expired session lands
  // on the re-login prompt instead of downloading an error body.
  const exportCsv = async () => {
    setExporting(true);
    setLogError('');
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (filter !== 'all') params.set('tub', filter);
      if (typeFilter !== 'all') params.set('entryType', typeFilter);
      const since = sinceIso(range);
      if (since) params.set('since', since);
      const res = await fetch(`/api/admin/water-tests?${params}`);
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `water-log-${filter}-${typeFilter}-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
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
      setChartRecords((prev) => prev.filter((r) => r.id !== record.id));
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
  const blocked = recommendations.filter((r) => r.severity === 'blocked');
  const infos = recommendations.filter((r) => r.severity === 'info');
  const reviewing = phase === 'reviewing';
  // Criticals already carry a "close the tub" instruction of their own; this
  // banner is what catches the unsafe case that has no critical — chlorine
  // under the target floor, which reads as a routine "add sanitizer" dose.
  const guestSafety = getGuestSafety(liveReadings);

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

        {entryType === 'refill' && (
          <p className="mb-4 font-mono text-xs text-white/30">
            Just log that the tub was drained and refilled — enter water tests separately as a Test
            entry.
          </p>
        )}

        {entryType !== 'refill' && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            {READING_FIELDS.map((field) => {
              const parsed = parseReading(readingInputs[field.key]);
              const invalid = parsed === undefined;
              const status = typeof parsed === 'number' ? classifyReading(field.key, parsed) : null;
              // During review the panel below carries the full recommendations;
              // keep the border tint but drop the per-field notes.
              const rec = typeof parsed === 'number' ? liveRecByParam.get(field.key) : undefined;
              return (
                <label key={field.key} className="block">
                  <span className="mb-1.5 flex items-center gap-1 text-xs font-mono-bold uppercase tracking-wide text-white/40">
                    <span>
                      {field.label}
                      {field.unit ? ` (${field.unit})` : ''}
                    </span>
                    <MeasurementInfoButton
                      parameter={field.key}
                      open={infoParam === field.key}
                      onOpenChange={(open) => setInfoParam(open ? field.key : null)}
                    />
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
                    className={readingInputClass(status, invalid, rec?.severity === 'blocked')}
                  />
                  {!reviewing && <LiveFieldNote rec={rec} status={status} invalid={invalid} />}
                </label>
              );
            })}
            <label className="block">
              <span className="mb-1.5 block text-xs font-mono-bold uppercase tracking-wide text-white/40">
                Test method
              </span>
              <select
                value={testMethod}
                onChange={(e) => setTestMethod(e.target.value as TestMethod)}
                disabled={reviewing}
                className={inputClass}
              >
                {TEST_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {TEST_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {entryType === 'test' && !reviewing && (
          <p className="mb-4 -mt-2 font-mono text-xs text-white/30">
            Blank = not tested. Targets shown in each field.
          </p>
        )}

        {/* Review panel */}
        {reviewing && (
          <div className="mb-4">
            {!guestSafety.safe && criticals.length === 0 && (
              <div className="mb-3 rounded border border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 p-3">
                <div className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-red)]">
                  Not guest-safe — keep the tub closed
                </div>
                {guestSafety.reasons.map((reason) => (
                  <div key={reason} className="mt-1 text-sm text-white/70">
                    {reason}
                  </div>
                ))}
              </div>
            )}

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

            {/* Deliberately not a dose: the reading is out of range but has to
             * wait on another correction (pH waits on TA). */}
            {blocked.map((rec) => (
              <div
                key={rec.parameter}
                className="mb-3 rounded border-2 border-[var(--pyre-red)] bg-[var(--pyre-red)]/10 p-3"
              >
                <div className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-red)]">
                  {rec.instruction}
                </div>
                <div className="mt-1 text-sm text-white/70">{rec.reason}</div>
              </div>
            ))}

            {doseDrafts.length === 0 && criticals.length === 0 && blocked.length === 0 && (
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
                {draft.instruction && (
                  <div className="mt-1 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-red)]">
                    {draft.instruction}
                  </div>
                )}
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
                {rec.instruction && (
                  <div className="mt-1 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-red)]">
                    {rec.instruction}
                  </div>
                )}
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

      {/* ---- Filters (scope the trends chart, the log and the CSV export) ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={pillClass(range === r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
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

      <div className="mb-4 flex flex-wrap gap-2">
        {ENTRY_TYPE_FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTypeFilter(value)}
            className={pillClass(typeFilter === value)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---- Trends (collapsed by default; the log below carries every number) ---- */}
      <details className="group mb-8 rounded-lg border border-white/10 bg-white/[0.02]">
        <summary className="flex cursor-pointer select-none items-center gap-2 p-4 font-primary-semibold text-lg hover:opacity-80">
          <span className="font-mono text-sm text-white/40 transition-transform group-open:rotate-90">
            ›
          </span>
          Trends
        </summary>
        <div className="px-4 pb-4">
          <WaterTrends
            records={chartRecords}
            visibleTubs={filter === 'all' ? [...TUBS] : [filter]}
          />
        </div>
      </details>

      {/* ---- Log ---- */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-primary-semibold text-lg">Log</h2>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          title="Downloads every entry matching the range and tub filters above"
          className="rounded border border-white/10 bg-white/5 px-3 py-2 font-mono-bold text-xs uppercase tracking-wide text-white/50 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {logError && <p className="mb-3 text-sm text-[var(--pyre-red)]">{logError}</p>}
      {!logError && records.length === 0 && !logLoading && (
        <p className="text-sm text-white/40">No entries yet.</p>
      )}

      {records.map((record) => {
        // Entries whose readings mean the tub should have been closed are
        // outlined in red, so scanning the log answers "was anyone in the
        // water when they shouldn't have been?" without reading the numbers.
        const safety = getGuestSafety(recordReadings(record));
        const editing = editingId === record.id;
        return (
          <div
            key={record.id}
            className={`mb-3 rounded-lg border p-4 ${
              safety.safe
                ? 'border-white/10 bg-white/[0.02]'
                : 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/[0.07] ring-1 ring-[var(--pyre-red)]'
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded bg-white/10 px-2 py-0.5 font-mono-bold text-xs uppercase tracking-wide">
                {record.tub}
              </span>
              {record.entry_type !== 'test' && (
                <span className="rounded bg-[var(--pyre-blue)]/20 px-2 py-0.5 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-blue)]">
                  {record.entry_type}
                </span>
              )}
              {!safety.safe && (
                <span className="rounded bg-[var(--pyre-red)] px-2 py-0.5 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-creme)]">
                  Unsafe for guests
                </span>
              )}
              <span className="ml-auto font-mono text-xs text-white/40">
                <RecordedAt iso={record.created_at} />
              </span>
            </div>

            {editing ? (
              <EditEntryPanel
                record={record}
                infoParam={infoParam}
                onInfoChange={setInfoParam}
                onCancel={() => setEditingId(null)}
                onSaved={(updated) => {
                  setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                  setChartRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                  setEditingId(null);
                }}
                onSessionExpired={() => setSessionExpired(true)}
              />
            ) : (
              <>
                <ReadingChips record={record} infoParam={infoParam} onInfoChange={setInfoParam} />

                {!safety.safe && (
                  <div className="mt-2 rounded border border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/10 px-2.5 py-2">
                    <div className="mb-1 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-red)]">
                      Guests should not have been in the water
                    </div>
                    <div className="space-y-0.5">
                      {safety.reasons.map((reason) => (
                        <div key={reason} className="text-sm text-white/70">
                          {reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anything put into the water is the entry's most consequential
                 * fact, so it gets its own gold-tinted block — scannable down a
                 * column of cards without reading any of them. */}
                {record.doses.length > 0 && (
                  <div className="mt-2 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-2.5 py-2">
                    <div className="mb-1 font-mono-bold text-xs uppercase tracking-wide text-[var(--pyre-gold)]/70">
                      Added to water
                    </div>
                    <div className="space-y-0.5">
                      {record.doses.map((dose) => (
                        <div
                          key={`${record.id}-${dose.chemical}`}
                          className="font-mono-bold text-sm text-[var(--pyre-gold)]"
                        >
                          ＋ {dose.chemical} {dose.grams} g
                          {dose.recommended_grams != null &&
                            dose.recommended_grams !== dose.grams && (
                              <span className="font-mono text-white/50">
                                {' '}
                                (chart: {dose.recommended_grams} g)
                              </span>
                            )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {record.notes && <div className="mt-2 text-sm text-white/50">{record.notes}</div>}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-white/30">
                    {record.recorded_by}
                    {record.test_method && ` · ${TEST_METHOD_LABELS[record.test_method]}`}
                  </span>
                  {/* Editing and deleting follow the same rule: your own entries
                   * only, admins included — the API enforces it either way. */}
                  {record.recorded_by.toLowerCase() === userEmail.toLowerCase() && (
                    <span className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingId(record.id)}
                        className="font-mono text-xs uppercase tracking-wide text-white/30 transition-colors hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteEntry(record)}
                        disabled={deletingId === record.id}
                        className="font-mono text-xs uppercase tracking-wide text-white/30 transition-colors hover:text-[var(--pyre-red)] disabled:opacity-50"
                      >
                        {deletingId === record.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}

      {records.length < total && (
        <button
          type="button"
          onClick={() => void loadLog(records.length, filter, range, typeFilter)}
          disabled={logLoading}
          className="w-full rounded-md border border-white/20 px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white disabled:opacity-50"
        >
          {logLoading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
