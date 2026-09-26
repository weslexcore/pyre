// Every setting admins can change from /admin/settings, with its type, its
// allowed values, its default, and the environment variable it used to live
// in (if any). Pure and client-bundle-safe: the page renders from this, and
// the server (./store) resolves each setting's current value from it.
//
// Adding a setting is one entry here. Read it on the server with
// getSetting('<key>') — the value comes back typed from the entry.
//
// What wins: a value saved on the settings page, else the environment
// variable, else the default. Resetting a setting on the page removes the
// saved value.

import { HIDEABLE_TOOLS } from '@/components/admin/adminTools';

export type SettingSection = 'suggestions' | 'navigation';

export const SETTING_SECTIONS: { key: SettingSection; label: string; description: string }[] = [
  {
    key: 'navigation',
    label: 'Page visibility',
    description:
      'Choose which tools appear in the dashboard, menu, pinned listings, and page search for everyone, including admins. Hidden pages still open through direct links under existing permissions. Widgets and quick actions stay available.',
  },
  {
    key: 'suggestions',
    label: 'Agent suggestions',
    description:
      'The agent that proposes tasks, task comments, and SOP edits from shift notes. Nothing it proposes happens until an admin approves it.',
  },
];

interface Base {
  label: string;
  description: string;
  section: SettingSection;
  /** The environment variable this setting falls back to, for display (./store reads it). */
  env?: string;
}

export interface BooleanSetting extends Base {
  type: 'boolean';
  default: boolean;
}

export interface MultiChoiceSetting extends Base {
  type: 'multi_choice';
  options: readonly { value: string; label: string }[];
  default: readonly string[];
  /** At least this many must stay chosen. */
  min?: number;
}

export type SettingDefinition = BooleanSetting | MultiChoiceSetting;

export const SETTINGS = {
  'navigation.hiddenTools': {
    type: 'multi_choice',
    section: 'navigation',
    label: 'Hidden pages',
    description:
      'Open any tool here, even when hidden. Settings always stays visible. Changes appear on navigation or refresh within about 30 seconds.',
    options: HIDEABLE_TOOLS.map((tool) => ({ value: tool.href, label: tool.title })),
    default: [],
  },
  'suggestions.enabled': {
    type: 'boolean',
    section: 'suggestions',
    label: 'Suggestions',
    description:
      'The AI button on a shift note also has the agent suggest tasks, task comments, and SOP edits after reading it. Turning this off leaves the button reading notes only, and stops automatic suggestions; suggestions already waiting stay in the inbox.',
    default: true,
  },
  'suggestions.auto': {
    type: 'boolean',
    section: 'suggestions',
    label: 'Suggest automatically',
    description:
      'After the classifier reads a note and finds one of the signals below, the agent looks at it without anyone pressing the AI button — once per version of the note, and not again after a suggestion from it was dismissed.',
    default: false,
    env: 'SUGGESTIONS_AUTO',
  },
  'suggestions.autoSignals': {
    type: 'multi_choice',
    section: 'suggestions',
    label: 'Signals that start an automatic look',
    description:
      'Which of the classifier’s findings make the agent look at a note on its own. Only used while Suggest automatically is on.',
    options: [
      { value: 'action', label: 'Action' },
      { value: 'update', label: 'Update' },
      { value: 'question', label: 'Question' },
      { value: 'safety', label: 'Safety' },
      { value: 'feedback', label: 'Feedback' },
    ],
    default: ['action', 'update'],
    min: 1,
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;

export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K] extends { type: 'boolean' }
  ? boolean
  : string[];

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && value in SETTINGS;
}

export function settingDefinition(key: SettingKey): SettingDefinition {
  return SETTINGS[key] as SettingDefinition;
}

/** A value checked against its setting: the typed value, or why it doesn't fit. */
export function parseSettingValue(
  key: SettingKey,
  raw: unknown
): { ok: true; value: boolean | string[] } | { ok: false; error: string } {
  const def = settingDefinition(key);
  if (def.type === 'boolean') {
    return typeof raw === 'boolean'
      ? { ok: true, value: raw }
      : { ok: false, error: `${def.label} must be on or off` };
  }
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) {
    return { ok: false, error: `${def.label} must be a list of choices` };
  }
  const allowed = new Set(def.options.map((o) => o.value));
  const unknown = raw.filter((v) => !allowed.has(v));
  if (unknown.length > 0) return { ok: false, error: `Not a choice: ${unknown.join(', ')}` };
  // Kept in the options' order, without repeats.
  const value = def.options.map((o) => o.value).filter((v) => raw.includes(v));
  if (value.length < (def.min ?? 0)) {
    return { ok: false, error: `Choose at least ${def.min} for ${def.label}` };
  }
  return { ok: true, value };
}

/** An env var's text as a setting's value, or undefined when it doesn't read as one. */
export function parseEnvValue(
  key: SettingKey,
  raw: string | undefined
): boolean | string[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const def = settingDefinition(key);
  const text = raw.trim().toLowerCase();
  if (def.type === 'boolean') {
    if (['on', 'true', '1', 'yes'].includes(text)) return true;
    if (['off', 'false', '0', 'no'].includes(text)) return false;
    return undefined;
  }
  const parsed = parseSettingValue(
    key,
    text
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  );
  return parsed.ok ? parsed.value : undefined;
}

/** Where a setting's current value comes from, for the page to say so. */
export type SettingSource = 'saved' | 'env' | 'default';

/** One setting as the page shows it. */
export interface SettingView {
  key: SettingKey;
  value: boolean | string[];
  source: SettingSource;
  /** The value it would have without the saved one (env, else default). */
  fallback: boolean | string[];
  updatedBy: string | null;
  updatedAt: string | null;
}
