// The schedule lint's rules (/admin/schedule-lint).
//
// Built-in rules are always listed and can be switched off or tuned; custom
// rules are instances of a template (opening hours, required tag, expected
// capacity) an admin adds with their own settings. "Preview" runs every rule
// against Momence right now and paints what each one catches under it, so a
// new setting can be checked before the next email goes out; "Email admins
// now" runs the real job.
//
// A finding that is genuinely fine can be resolved from here: it leaves the
// email and the digest but stays on this page, with an optional note, until
// somebody reopens it or the lint stops raising it altogether.

import { Fragment, useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import {
  DAY_KEYS,
  type DayKey,
  type DayWindow,
  type Finding,
  NOTE_MAX,
  type OpeningHours,
  type ParamField,
  type Resolution,
  type RuleInstance,
  type RuleKind,
  type Severity,
} from '@/lib/schedule-lint/types';
import { ConfirmDialog } from './ConfirmDialog';
import { QuietBadge, send } from './guestUi';
import {
  buttonClass,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
} from './incidentUi';

const API = '/api/admin/schedule-lint';

interface KindInfo {
  kind: RuleKind;
  title: string;
  description: string;
  builtIn: boolean;
  fields: ParamField[];
  defaults: Record<string, unknown>;
}

interface ListedRule extends RuleInstance {
  summary: string;
}

interface StateResponse {
  rules: ListedRule[];
  resolutions: Resolution[];
  kinds: KindInfo[];
  sessionTypes: string[];
  horizonDays: number;
}

interface PreviewReport {
  horizonStart: string;
  horizonEnd: string;
  digest: string;
  findings: Finding[];
  /** Raised by a rule, but marked resolved; listed apart, not counted. */
  resolved: Finding[];
  byRule: Record<string, number>;
  bySeverity: Record<Severity, number>;
}

const TIME_ZONE = 'America/New_York';

const DAY_LABEL: Record<DayKey, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

const SEVERITY_STYLE: Record<Severity, string> = {
  cancel: 'text-[var(--pyre-red)]',
  fix: 'text-[var(--pyre-gold)]',
  notice: 'text-white/50',
};

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One setting, rendered from its field description. */
function ParamInput({
  id,
  field,
  value,
  sessionTypes,
  onChange,
}: {
  id: string;
  field: ParamField;
  value: unknown;
  sessionTypes: string[];
  onChange: (next: unknown) => void;
}) {
  switch (field.type) {
    case 'number':
      return (
        <input
          id={id}
          type="number"
          className={inputClass}
          min={field.min}
          max={field.max}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'text':
      return (
        <input
          id={id}
          className={inputClass}
          maxLength={120}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 accent-[var(--pyre-red)]"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'type':
      return (
        <select
          id={id}
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {sessionTypes.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </select>
      );
    case 'types': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div id={id} className="flex flex-wrap gap-1.5">
          {sessionTypes.map((t) => {
            const on = chosen.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? chosen.filter((c) => c !== t) : [...chosen, t])}
                className={`rounded border px-2 py-1 font-mono text-xs uppercase tracking-wide transition-colors ${
                  on
                    ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]'
                    : 'border-white/15 text-white/50 hover:border-white/40 hover:text-white'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      );
    }
    case 'durations': {
      // Kept as typed text so a half-finished "60, 12" doesn't fight the
      // cursor; registry.ts parses the same string on save.
      const text = Array.isArray(value) ? (value as number[]).join(', ') : String(value ?? '');
      return (
        <input
          id={id}
          className={inputClass}
          inputMode="numeric"
          placeholder="60, 120"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    case 'opening-hours': {
      const days = (value ?? {}) as Partial<OpeningHours>;
      const setDay = (day: DayKey, next: DayWindow | null) => onChange({ ...days, [day]: next });
      return (
        <div id={id} className="space-y-1.5">
          {DAY_KEYS.map((day) => {
            const window = days[day] ?? null;
            return (
              <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-24 text-white/70">{DAY_LABEL[day]}</span>
                <label className="flex items-center gap-1.5 text-xs text-white/50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--pyre-red)]"
                    checked={window !== null}
                    onChange={(e) =>
                      setDay(day, e.target.checked ? { open: '16:00', close: '20:00' } : null)
                    }
                  />
                  Open
                </label>
                {window && (
                  <>
                    <input
                      type="time"
                      aria-label={`${DAY_LABEL[day]} opens`}
                      className={`${inputClass} w-auto`}
                      value={window.open}
                      onChange={(e) => setDay(day, { ...window, open: e.target.value })}
                    />
                    <span className="text-white/40">to</span>
                    <input
                      type="time"
                      aria-label={`${DAY_LABEL[day]} closes`}
                      className={`${inputClass} w-auto`}
                      value={window.close}
                      onChange={(e) => setDay(day, { ...window, close: e.target.value })}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      );
    }
  }
}

function ParamsForm({
  idPrefix,
  fields,
  params,
  sessionTypes,
  onChange,
}: {
  idPrefix: string;
  fields: ParamField[];
  params: Record<string, unknown>;
  sessionTypes: string[];
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (fields.length === 0) {
    return <p className="text-xs text-white/40">This rule has no settings.</p>;
  }
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        return (
          <div key={field.key}>
            <label className={labelClass} htmlFor={id}>
              {field.label}
            </label>
            <ParamInput
              id={id}
              field={field}
              value={params[field.key]}
              sessionTypes={sessionTypes}
              onChange={(next) => onChange({ ...params, [field.key]: next })}
            />
            {field.hint && <p className="mt-1 text-xs text-white/40">{field.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

function FindingRow({ finding, action }: { finding: Finding; action?: React.ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <div className="min-w-0">
        <span className={`font-mono uppercase tracking-wide ${SEVERITY_STYLE[finding.severity]}`}>
          {finding.severity}
        </span>{' '}
        {finding.session ? (
          <>
            {finding.session.link ? (
              <a
                href={finding.session.link}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--pyre-creme)] underline"
              >
                {finding.session.title}
              </a>
            ) : (
              <span className="text-[var(--pyre-creme)]">{finding.session.title}</span>
            )}
            <span className="text-white/50"> · {when(finding.session.startsAt)}</span>
            <span className="block text-white/60">{finding.message}</span>
          </>
        ) : (
          <span className="text-white/60">{finding.message}</span>
        )}
      </div>
      {action}
    </li>
  );
}

/** The line a resolution is filed under, and the way back. */
function ResolvedRow({
  entry,
  ruleLabel,
  disabled,
  onReopen,
}: {
  entry: Resolution;
  ruleLabel?: string;
  disabled: boolean;
  onReopen: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <div className="min-w-0">
        <span className="font-mono uppercase tracking-wide text-white/35">resolved</span>{' '}
        <span className="text-white/60">{entry.summary}</span>
        {entry.note && <span className="block text-white/45">"{entry.note}"</span>}
        <span className="block text-white/30">
          {ruleLabel ? `${ruleLabel} · ` : ''}
          {entry.resolvedBy ?? 'an admin'} · {when(entry.resolvedAt)}
        </span>
      </div>
      <button type="button" className={buttonClass} disabled={disabled} onClick={onReopen}>
        Reopen
      </button>
    </li>
  );
}

export function ScheduleLintRules() {
  const { data, error, loading, setData, reload } = useCachedJson<StateResponse>(API);
  const rules = useMemo(() => data?.rules ?? [], [data]);
  const resolutions = useMemo(() => data?.resolutions ?? [], [data]);
  const kinds = useMemo(() => data?.kinds ?? [], [data]);
  const sessionTypes = data?.sessionTypes ?? [];
  const kindOf = (kind: string) => kinds.find((k) => k.kind === kind);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; params: Record<string, unknown> } | null>(
    null
  );
  const [adding, setAdding] = useState<{
    kind: RuleKind;
    label: string;
    params: Record<string, unknown>;
  } | null>(null);
  const [deleting, setDeleting] = useState<ListedRule | null>(null);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<PreviewReport | null>(null);
  /** The finding whose "why this is fine" note is being typed. */
  const [resolving, setResolving] = useState<{ finding: Finding; note: string } | null>(null);

  const builtIns = rules.filter((r) => r.builtIn);
  const customs = rules.filter((r) => !r.builtIn);
  const customKinds = kinds.filter((k) => !k.builtIn);
  // The ones a preview already showed under their rule are not repeated here;
  // what is left are resolutions nothing is raising any more.
  const stray = preview
    ? resolutions.filter((r) => !preview.resolved.some((f) => f.key === r.key))
    : resolutions;

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const result = await send<StateResponse & Record<string, unknown>>(API, 'POST', body);
      if (result.rules) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                rules: result.rules,
                resolutions: result.resolutions ?? prev.resolutions,
                kinds: result.kinds,
              }
            : prev
        );
        invalidateJson(API);
      }
      return result;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const toggle = (rule: ListedRule) =>
    void post({ action: 'update', id: rule.id, enabled: !rule.enabled }, rule.id);

  const startEdit = (rule: ListedRule) => {
    setEditing(rule.id);
    setDraft({ label: rule.label, params: { ...rule.params } });
    setMessage(null);
  };

  const saveEdit = async (rule: ListedRule) => {
    if (!draft) return;
    const result = await post(
      { action: 'update', id: rule.id, label: draft.label, params: draft.params },
      rule.id
    );
    if (result) {
      setEditing(null);
      setDraft(null);
      setPreview(null);
    }
  };

  const startAdd = (kind: RuleKind) => {
    const info = kindOf(kind);
    if (!info) return;
    setAdding({ kind, label: info.title, params: { ...info.defaults } });
    setMessage(null);
  };

  const create = async () => {
    if (!adding) return;
    const result = await post({ action: 'create', ...adding }, 'add');
    if (result) {
      setAdding(null);
      setPreview(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await post({ action: 'delete', id: deleting.id }, deleting.id);
    if (result) {
      setDeleting(null);
      setPreview(null);
    }
  };

  const runPreview = async () => {
    setNotice(null);
    const result = await post({ action: 'preview' }, 'preview');
    if (result?.report) {
      const report = result.report as PreviewReport;
      setPreview(report);
      const resolvedNote = report.resolved.length
        ? ` ${report.resolved.length} resolved finding${
            report.resolved.length === 1 ? ' is' : 's are'
          } listed separately and stay out of the email.`
        : '';
      setNotice(
        report.findings.length === 0
          ? `Checked Momence: nothing to report.${resolvedNote}`
          : `Checked Momence: ${report.findings.length} finding${
              report.findings.length === 1 ? '' : 's'
            } (${report.bySeverity.cancel} to cancel, ${report.bySeverity.fix} to fix, ${
              report.bySeverity.notice
            } notices). Disabled rules are shown too, so you can see what switching one on would send.${resolvedNote}`
      );
    }
  };

  const runSend = async () => {
    setSending(false);
    setNotice(null);
    const result = await post({ action: 'send' }, 'send');
    const summary = result?.summary as
      | {
          findings: number;
          sent: number;
          duplicates: number;
          failed: string[];
          resolved?: number;
        }
      | undefined;
    if (summary) {
      setNotice(
        summary.findings === 0
          ? 'Ran the lint: nothing to report, so nobody was emailed.'
          : `Ran the lint: ${summary.findings} findings; emailed ${summary.sent} admin${
              summary.sent === 1 ? '' : 's'
            }${
              summary.duplicates
                ? `, ${summary.duplicates} already had this exact list this week`
                : ''
            }${summary.failed.length ? `, ${summary.failed.length} failed` : ''}.${
              summary.resolved ? ` ${summary.resolved} resolved, left out.` : ''
            }`
      );
      await reload();
    }
  };

  const findingsFor = (ruleId: string): Finding[] =>
    preview?.findings.filter((f) => f.ruleId === ruleId) ?? [];

  const resolvedFor = (ruleId: string): Finding[] =>
    preview?.resolved.filter((f) => f.ruleId === ruleId) ?? [];

  /**
   * Resolving moves the finding across in the preview rather than re-running
   * it: the schedule has not changed, only what we have said about it.
   */
  const resolve = async () => {
    if (!resolving) return;
    const { finding, note } = resolving;
    const result = await post(
      {
        action: 'resolve',
        key: finding.key,
        ruleId: finding.ruleId,
        summary: finding.message,
        note,
      },
      finding.key
    );
    if (!result) return;
    setResolving(null);
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.filter((f) => f.key !== finding.key),
            resolved: [...prev.resolved, finding],
            byRule: { ...prev.byRule, [finding.ruleId]: (prev.byRule[finding.ruleId] ?? 1) - 1 },
            bySeverity: {
              ...prev.bySeverity,
              [finding.severity]: prev.bySeverity[finding.severity] - 1,
            },
          }
        : prev
    );
  };

  const unresolve = async (key: string) => {
    const result = await post({ action: 'unresolve', key }, key);
    if (!result) return;
    setPreview((prev) => {
      const finding = prev?.resolved.find((f) => f.key === key);
      if (!prev || !finding) return prev;
      return {
        ...prev,
        findings: [...prev.findings, finding],
        resolved: prev.resolved.filter((f) => f.key !== key),
        byRule: { ...prev.byRule, [finding.ruleId]: (prev.byRule[finding.ruleId] ?? 0) + 1 },
        bySeverity: {
          ...prev.bySeverity,
          [finding.severity]: prev.bySeverity[finding.severity] + 1,
        },
      };
    });
  };

  const renderRule = (rule: ListedRule) => {
    const info = kindOf(rule.kind);
    const isEditing = editing === rule.id && draft;
    const found = findingsFor(rule.id);
    const settled = resolvedFor(rule.id);
    return (
      <li key={rule.id} className={`${cardClass} ${rule.enabled ? '' : 'opacity-70'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-primary-semibold text-[var(--pyre-creme)]">
                {rule.label}
              </span>
              {!rule.builtIn && info && <QuietBadge>{info.title}</QuietBadge>}
              {rule.builtIn && <QuietBadge>Built in</QuietBadge>}
              {!rule.enabled && <QuietBadge>Off</QuietBadge>}
              {preview && (
                <span
                  className={`font-mono text-xs ${
                    found.length ? 'text-[var(--pyre-gold)]' : 'text-white/40'
                  }`}
                >
                  {found.length} finding{found.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {info && <p className="mt-0.5 text-xs text-white/45">{info.description}</p>}
            {!isEditing && rule.summary && (
              <p className="mt-1 text-xs text-white/60">{rule.summary}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => toggle(rule)}
            >
              {rule.enabled ? 'Turn off' : 'Turn on'}
            </button>
            {!isEditing && (info?.fields.length || !rule.builtIn) ? (
              <button
                type="button"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => startEdit(rule)}
              >
                Edit
              </button>
            ) : null}
            {!rule.builtIn && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => setDeleting(rule)}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {isEditing && info && (
          <div className="mt-3 space-y-3 rounded border border-white/10 bg-white/[0.02] p-3">
            {!rule.builtIn && (
              <div>
                <label className={labelClass} htmlFor={`edit-label-${rule.id}`}>
                  Label
                </label>
                <input
                  id={`edit-label-${rule.id}`}
                  className={inputClass}
                  maxLength={80}
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
            )}
            <ParamsForm
              idPrefix={`edit-${rule.id}`}
              fields={info.fields}
              params={draft.params}
              sessionTypes={sessionTypes}
              onChange={(params) => setDraft({ ...draft, params })}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy !== null}
                onClick={() => void saveEdit(rule)}
              >
                {busy === rule.id ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => {
                  setEditing(null);
                  setDraft(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {preview && (found.length > 0 || settled.length > 0) && (
          <ul className="mt-3 divide-y divide-white/5 border-t border-white/10 pt-2">
            {found.map((f) => (
              <Fragment key={f.key}>
                <FindingRow
                  finding={f}
                  action={
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy !== null}
                      onClick={() => setResolving({ finding: f, note: '' })}
                    >
                      Resolve
                    </button>
                  }
                />
                {resolving?.finding.key === f.key && (
                  <li className="flex flex-wrap items-center gap-2 py-2">
                    <input
                      className={`${inputClass} w-auto grow`}
                      maxLength={NOTE_MAX}
                      placeholder="Why this one is fine (optional)"
                      value={resolving.note}
                      onChange={(e) => setResolving({ ...resolving, note: e.target.value })}
                    />
                    <button
                      type="button"
                      className={primaryButtonClass}
                      disabled={busy !== null}
                      onClick={() => void resolve()}
                    >
                      {busy === f.key ? 'Resolving…' : 'Resolve'}
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy !== null}
                      onClick={() => setResolving(null)}
                    >
                      Cancel
                    </button>
                  </li>
                )}
              </Fragment>
            ))}
            {settled.map((f) => {
              const entry = resolutions.find((r) => r.key === f.key);
              return entry ? (
                <ResolvedRow
                  key={f.key}
                  entry={entry}
                  disabled={busy !== null}
                  onReopen={() => void unresolve(f.key)}
                />
              ) : null;
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={busy !== null}
          onClick={() => void runPreview()}
        >
          {busy === 'preview' ? 'Checking Momence…' : 'Preview findings'}
        </button>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy !== null}
          onClick={() => setSending(true)}
        >
          {busy === 'send' ? 'Running…' : 'Email admins now'}
        </button>
        {data?.horizonDays ? (
          <span className="font-mono text-xs text-white/40">
            Looks {data.horizonDays} days ahead
          </span>
        ) : null}
      </div>

      {error && <p className="text-sm text-[var(--pyre-red)]">Couldn't load: {error}</p>}
      {message && <p className="text-sm text-[var(--pyre-red)]">{message}</p>}
      {notice && <p className="text-sm text-[var(--pyre-sage)]">{notice}</p>}
      {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {builtIns.length > 0 && (
        <section className="space-y-3">
          <SectionTitle note="Always here; switch one off or tune it.">Built-in rules</SectionTitle>
          <ul className="space-y-3">{builtIns.map(renderRule)}</ul>
        </section>
      )}

      {data && (
        <section className="space-y-3">
          <SectionTitle note="Your own checks, from a template. Add as many as you need.">
            Custom rules
          </SectionTitle>
          {customs.length > 0 ? (
            <ul className="space-y-3">{customs.map(renderRule)}</ul>
          ) : (
            !adding && (
              <p className="text-sm text-white/50">
                No custom rules yet. Opening hours is the one most worth adding: it is the only way
                the lint knows a Monday session should not exist.
              </p>
            )
          )}

          {adding ? (
            <div className={`${cardClass} space-y-3`}>
              <p className="text-sm text-[var(--pyre-creme)]">
                New rule: {kindOf(adding.kind)?.title}
              </p>
              <div>
                <label className={labelClass} htmlFor="add-label">
                  Label
                </label>
                <input
                  id="add-label"
                  className={inputClass}
                  maxLength={80}
                  value={adding.label}
                  onChange={(e) => setAdding({ ...adding, label: e.target.value })}
                />
              </div>
              <ParamsForm
                idPrefix="add"
                fields={kindOf(adding.kind)?.fields ?? []}
                params={adding.params}
                sessionTypes={sessionTypes}
                onChange={(params) => setAdding({ ...adding, params })}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={busy !== null}
                  onClick={() => void create()}
                >
                  {busy === 'add' ? 'Adding…' : 'Add rule'}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy !== null}
                  onClick={() => setAdding(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wide text-white/50">Add</span>
              {customKinds.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  className={buttonClass}
                  disabled={busy !== null}
                  title={k.description}
                  onClick={() => startAdd(k.kind)}
                >
                  {k.title}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {stray.length > 0 && (
        <section className="space-y-3">
          <SectionTitle
            note={
              preview
                ? 'Resolved, and not raised by the check just now — the schedule has moved on. Dropped automatically after 30 days without being raised.'
                : 'Findings called fine. They stay out of the email until reopened. Preview to see which of them the schedule still raises.'
            }
          >
            Resolved
          </SectionTitle>
          <ul className={`${cardClass} divide-y divide-white/5`}>
            {stray.map((entry) => (
              <ResolvedRow
                key={entry.key}
                entry={entry}
                ruleLabel={rules.find((r) => r.id === entry.ruleId)?.label}
                disabled={busy !== null}
                onReopen={() => void unresolve(entry.key)}
              />
            ))}
          </ul>
        </section>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.label}"?`}
          body="The rule stops running at the next check. Nothing else changes; findings it already emailed stay in the inbox."
          confirmLabel="Delete rule"
          danger
          busy={busy === deleting.id}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}

      {sending && (
        <ConfirmDialog
          title="Run the lint and email the admins?"
          body="Every enabled rule runs against Momence right now. Admins who already received this exact list this week are skipped; anyone else gets the email."
          confirmLabel="Run and email"
          busy={busy === 'send'}
          onConfirm={() => void runSend()}
          onCancel={() => setSending(false)}
        />
      )}
    </div>
  );
}
