// App settings (/admin/settings): the feature switches and choices defined
// in lib/settings/registry, grouped by section. A change saves at once and
// reaches every server within about 30 seconds — no redeploy. Each setting
// says where its current value comes from (saved here, an environment
// variable, or the default), and a saved one can be reset back to that.

import { useEffect, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { readError } from '@/lib/client/api';
import { etStamp } from '@/lib/client/format';
import {
  type AnySettingValue,
  SETTING_SECTIONS,
  SETTINGS,
  type SettingDefinition,
  type SettingKey,
  type SettingView,
} from '@/lib/settings/registry';
import type { PeopleNames } from '@/lib/sops/names';
import { personName } from '@/lib/sops/names';
import {
  type DueDays,
  IMPORTANCE_LABELS,
  IMPORTANCES,
  MAX_DUE_DAYS,
  SEVERITIES,
  SEVERITY_LABELS,
} from '@/lib/suggestions/priority';
import { ADMIN_TOOL_SECTIONS, HIDEABLE_TOOLS } from './adminTools';
import { Toggle } from './Toggle';

/** Settings that still live on the page they belong to. */
const ELSEWHERE: { href: string; label: string; description: string }[] = [
  {
    href: '/admin/schedule',
    label: 'Staff schedule',
    description: 'Whether staff can request open shifts and ask for subs.',
  },
  {
    href: '/admin/email-templates',
    label: 'Email templates',
    description: 'Which emails send to everyone, the test whitelist, and paused journeys.',
  },
];

function describeValue(def: SettingDefinition, value: AnySettingValue): string {
  if (def.type === 'boolean') return value ? 'on' : 'off';
  if (def.type === 'due_days') return 'the default days';
  const labels = def.options
    .filter((o) => (value as string[]).includes(o.value))
    .map((o) => o.label);
  return labels.length > 0 ? labels.join(', ') : 'none';
}

/** One cell of the due-days grid: whole days, or blank for no due date. Saves on blur. */
function DueDaysCell({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: number | null;
  label: string;
  disabled: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const text = draft.trim();
    const next = text === '' ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > MAX_DUE_DAYS)) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_DUE_DAYS}
      aria-label={label}
      placeholder="none"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="w-16 rounded border border-white/15 bg-black/30 px-2 py-1 text-right font-mono text-xs text-[var(--pyre-creme)] focus:border-[var(--pyre-gold)]/60 focus:outline-none disabled:opacity-40"
    />
  );
}

function DueDaysGrid({
  value,
  disabled,
  onChange,
}: {
  value: DueDays;
  disabled: boolean;
  onChange: (next: DueDays) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="pb-1 pr-3 text-left font-mono text-[10px] font-normal uppercase tracking-wide text-white/40">
              Severity / importance
            </th>
            {IMPORTANCES.map((importance) => (
              <th
                key={importance}
                className="px-1 pb-1 text-right font-mono text-[10px] font-normal uppercase tracking-wide text-white/50"
              >
                {IMPORTANCE_LABELS[importance]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SEVERITIES.map((severity) => (
            <tr key={severity}>
              <th className="py-0.5 pr-3 text-left font-mono text-[10px] font-normal uppercase tracking-wide text-white/50">
                {SEVERITY_LABELS[severity]}
              </th>
              {IMPORTANCES.map((importance) => (
                <td key={importance} className="px-1 py-0.5 text-right">
                  <DueDaysCell
                    value={value[severity][importance]}
                    label={`Days for ${SEVERITY_LABELS[severity]} severity, ${IMPORTANCE_LABELS[importance]} importance`}
                    disabled={disabled}
                    onCommit={(next) =>
                      onChange({ ...value, [severity]: { ...value[severity], [importance]: next } })
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 font-mono text-[10px] text-white/40">
        Days from the day the task is suggested. 0 is due the same day.
      </p>
    </div>
  );
}

function SettingRow({
  view,
  people,
  busy,
  onSave,
  onReset,
}: {
  view: SettingView;
  people: PeopleNames;
  busy: boolean;
  onSave: (key: SettingKey, value: AnySettingValue) => void;
  onReset: (key: SettingKey) => void;
}) {
  const def = SETTINGS[view.key] as SettingDefinition;
  const source =
    view.source === 'saved'
      ? `Set here${view.updatedBy ? ` by ${personName(view.updatedBy, people)}` : ''}${
          view.updatedAt ? ` · ${etStamp(view.updatedAt)}` : ''
        }`
      : view.source === 'env'
        ? `From the ${def.env} environment variable`
        : 'Default';

  return (
    <li className="space-y-2 border-b border-white/10 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-[var(--pyre-creme)]">{def.label}</p>
          <p className="text-xs text-white/60">{def.description}</p>
        </div>
        {def.type === 'boolean' && (
          <Toggle
            checked={view.value === true}
            disabled={busy}
            label={def.label}
            onChange={(next) => onSave(view.key, next)}
          />
        )}
      </div>
      {view.key === 'navigation.hiddenTools' && (
        <div className="space-y-4">
          {ADMIN_TOOL_SECTIONS.map((section) => (
            <div key={section.key}>
              <h3 className="mb-2 font-mono text-xs uppercase text-white/50">{section.label}</h3>
              <ul className="space-y-3">
                {HIDEABLE_TOOLS.filter((tool) => tool.section === section.key).map((tool) => {
                  const hidden = (view.value as string[]).includes(tool.href);
                  return (
                    <li key={tool.href} className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-[var(--pyre-creme)]">{tool.title}</p>
                        <a
                          href={tool.href}
                          className="text-xs text-white/60 underline hover:text-white"
                          aria-label={`Open ${tool.title}`}
                        >
                          Open page
                        </a>
                        <span className="ml-2 text-xs text-white/40">
                          {hidden ? 'Hidden' : 'Visible'}
                        </span>
                      </div>
                      <Toggle
                        checked={!hidden}
                        disabled={busy}
                        label={`Show ${tool.title} in dashboard`}
                        onChange={(show) =>
                          onSave(
                            view.key,
                            show
                              ? (view.value as string[]).filter((href) => href !== tool.href)
                              : [...(view.value as string[]), tool.href]
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {def.type === 'due_days' && (
        <DueDaysGrid
          value={view.value as DueDays}
          disabled={busy}
          onChange={(next) => onSave(view.key, next)}
        />
      )}
      {def.type === 'multi_choice' && view.key !== 'navigation.hiddenTools' && (
        <div className="flex flex-wrap gap-2">
          {def.options.map((option) => {
            const chosen = (view.value as string[]).includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={chosen}
                disabled={busy}
                onClick={() =>
                  onSave(
                    view.key,
                    chosen
                      ? (view.value as string[]).filter((v) => v !== option.value)
                      : [...(view.value as string[]), option.value]
                  )
                }
                className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors disabled:opacity-40 ${
                  chosen
                    ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)]'
                    : 'border-white/15 text-white/50 hover:border-white/30 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
      <p className="font-mono text-[10px] text-white/40">
        {source}
        {view.source === 'saved' && (
          <>
            {' · '}
            <button
              type="button"
              className="underline hover:text-white disabled:opacity-40"
              disabled={busy}
              onClick={() => onReset(view.key)}
            >
              reset to {describeValue(def, view.fallback)}
            </button>
          </>
        )}
      </p>
    </li>
  );
}

export function SettingsPage({ initial, people }: { initial: SettingView[]; people: PeopleNames }) {
  const [settings, setSettings] = useState<SettingView[]>(initial);
  const [busy, setBusy] = useState<SettingKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const call = async (key: SettingKey, request: Promise<Response>, done: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await request;
      if (!res.ok) throw new Error(await readError(res));
      setSettings(((await res.json()) as { settings: SettingView[] }).settings);
      setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const save = (key: SettingKey, value: AnySettingValue) =>
    void call(
      key,
      fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      }),
      `Saved ${SETTINGS[key].label}. It takes effect within about 30 seconds.`
    );

  const reset = (key: SettingKey) =>
    void call(
      key,
      fetch(`/api/admin/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
      `Reset ${SETTINGS[key].label}.`
    );

  return (
    <div className="space-y-6">
      {notice && (
        <p
          aria-live="polite"
          className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 text-sm text-[var(--pyre-sage)]"
        >
          {notice}
        </p>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {SETTING_SECTIONS.map((section) => {
        const rows = settings.filter((view) => SETTINGS[view.key].section === section.key);
        if (rows.length === 0) return null;
        return (
          <section key={section.key} className="rounded border border-white/10 bg-white/5 px-4">
            <div className="border-b border-white/10 py-3">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/70">
                {section.label}
              </h2>
              <p className="mt-1 text-xs text-white/50">{section.description}</p>
            </div>
            <ul>
              {rows.map((view) => (
                <SettingRow
                  key={view.key}
                  view={view}
                  people={people}
                  busy={busy !== null}
                  onSave={save}
                  onReset={reset}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/50">
          Settings on other pages
        </h2>
        <ul className="space-y-1">
          {ELSEWHERE.map((item) => (
            <li key={item.href} className="text-xs text-white/50">
              <a href={item.href} className="text-[var(--pyre-creme)] underline hover:text-white">
                {item.label}
              </a>{' '}
              — {item.description}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
