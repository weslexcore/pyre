// App settings (/admin/settings): the feature switches and choices defined
// in lib/settings/registry, grouped by section. A change saves at once and
// reaches every server within about 30 seconds — no redeploy. Each setting
// says where its current value comes from (saved here, an environment
// variable, or the default), and a saved one can be reset back to that.

import { useEffect, useState } from 'react';
import {
  SETTING_SECTIONS,
  SETTINGS,
  type SettingDefinition,
  type SettingKey,
  type SettingView,
} from '@/lib/settings/registry';
import type { PeopleNames } from '@/lib/sops/names';
import { personName } from '@/lib/sops/names';
import { readError } from './ShiftNoteComposer';

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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function describeValue(def: SettingDefinition, value: boolean | string[]): string {
  if (def.type === 'boolean') return value ? 'on' : 'off';
  const labels = def.options
    .filter((o) => (value as string[]).includes(o.value))
    .map((o) => o.label);
  return labels.length > 0 ? labels.join(', ') : 'none';
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
        checked
          ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/30'
          : 'border-white/20 bg-white/5'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${
          checked ? 'left-5.5 bg-[var(--pyre-gold)]' : 'left-0.5 bg-white/50'
        }`}
      />
    </button>
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
  onSave: (key: SettingKey, value: boolean | string[]) => void;
  onReset: (key: SettingKey) => void;
}) {
  const def = SETTINGS[view.key] as SettingDefinition;
  const source =
    view.source === 'saved'
      ? `Set here${view.updatedBy ? ` by ${personName(view.updatedBy, people)}` : ''}${
          view.updatedAt ? ` · ${formatWhen(view.updatedAt)}` : ''
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
      {def.type === 'multi_choice' && (
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

  const save = (key: SettingKey, value: boolean | string[]) =>
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
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

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
