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
import {
  type Checkpoint,
  DEFAULT_CHECKPOINTS,
  DEFAULT_SESSION_LENGTHS,
  parseCheckpoints,
  parseSessionLengths,
} from '@/lib/guests/floor-timing';
import { DEFAULT_DUE_DAYS, type DueDays, parseDueDays } from '@/lib/suggestions/priority';

export type SettingSection = 'suggestions' | 'sops' | 'navigation' | 'guests' | 'momence';

export const SETTING_SECTIONS: { key: SettingSection; label: string; description: string }[] = [
  {
    key: 'navigation',
    label: 'Page visibility',
    description:
      'Choose which tools appear in the dashboard, menu, pinned listings, and page search for everyone, including admins. Hidden pages still open through direct links under existing permissions. Widgets and quick actions stay available.',
  },
  {
    key: 'guests',
    label: 'Guests',
    description:
      'The Guests pages: Check Ins, the check-ins staff make with each guest during their session, and the session lengths staff can pick.',
  },
  {
    key: 'momence',
    label: 'Momence',
    description:
      'How the app reads what guests buy in Momence: which products are the intro offer, for email journeys, purchase reports, Check Ins and member counts.',
  },
  {
    key: 'suggestions',
    label: 'Agent suggestions',
    description:
      'The agent that proposes tasks, task comments, and SOP edits from shift notes. Nothing it proposes happens until an admin approves it.',
  },
  {
    key: 'sops',
    label: 'SOP writing assistant',
    description:
      'AI help in the SOP editor: drafting a document from rough notes, reviewing one for clarity and consistency, and asking the editor about anything it needs to fill in. Nothing it writes is saved until the editor accepts it and saves.',
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

/** Days until due for each severity and importance (lib/suggestions/priority). */
export interface DueDaysSetting extends Base {
  type: 'due_days';
  default: DueDays;
}

/** The check-ins staff make with each guest (lib/guests/floor-timing). */
export interface CheckpointsSetting extends Base {
  type: 'checkpoints';
  default: readonly Checkpoint[];
}

/** A list of whole minutes, such as the session lengths staff can pick. */
export interface MinutesListSetting extends Base {
  type: 'minutes_list';
  default: readonly number[];
}

/** Momence catalog membership ids (the number in a momence.com/m/<id> checkout link). */
export interface MembershipIdsSetting extends Base {
  type: 'membership_ids';
  default: readonly number[];
}

export const MAX_MEMBERSHIP_IDS = 20;

/** The id in a Momence checkout link (momence.com/m/966626, or …/membership/Name/966626), or the bare id. */
export function membershipIdFrom(text: string): number | null {
  const trimmed = text.trim();
  const match = /^\d+$/.test(trimmed)
    ? trimmed
    : /momence\.com\/.*?(\d+)\/?(?:[?#].*)?$/.exec(trimmed)?.[1];
  const id = match ? Number(match) : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type SettingDefinition =
  | BooleanSetting
  | MembershipIdsSetting
  | MultiChoiceSetting
  | DueDaysSetting
  | CheckpointsSetting
  | MinutesListSetting;

/** Any setting's value, untyped by key. */
export type AnySettingValue = boolean | string[] | DueDays | Checkpoint[] | number[];

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
  'guests.profiles': {
    type: 'boolean',
    section: 'guests',
    label: 'Guest profiles',
    description:
      'The guest list, Who’s coming, profile fields, and each guest’s profile page. Off, those pages open Check Ins instead and their tabs are hidden; profiles already saved are kept.',
    default: false,
  },
  'floor.checkpoints': {
    type: 'checkpoints',
    section: 'guests',
    label: 'Check-ins during a session',
    description:
      'The moments staff check on each guest. Check Ins highlights a guest when one comes due, until someone marks it done. Add as many as you like, timed from when the guest arrives or from when their session ends.',
    default: DEFAULT_CHECKPOINTS,
  },
  'floor.sessionLengths': {
    type: 'minutes_list',
    section: 'guests',
    label: 'Session lengths',
    description:
      'The lengths staff can give a guest under Adjust on Check Ins. A guest starts on their Momence session’s own length, which is always offered too.',
    default: DEFAULT_SESSION_LENGTHS,
  },
  'momence.introOfferIds': {
    type: 'membership_ids',
    section: 'momence',
    label: 'Intro offer products',
    description:
      'The Momence products that count as the intro offer. Buying one starts the intro journeys, and the intro conditions, reports and Check Ins look for these. Add the number at the end of the product’s checkout link (momence.com/m/…). Keep a retired intro listed while guests who bought it are still on it.',
    default: [],
    env: 'MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS',
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
      { value: 'hours', label: 'Hours' },
      { value: 'question', label: 'Question' },
      { value: 'safety', label: 'Safety' },
      { value: 'feedback', label: 'Feedback' },
    ],
    default: ['action', 'update', 'hours'],
    min: 1,
  },
  'sops.assist': {
    type: 'boolean',
    section: 'sops',
    label: 'Writing assistant',
    description:
      'Shows the assistant in the SOP editor, the AI Review button on each document, and the rough-notes box on the new SOP form. Turning it off hides all three for everyone; saved documents are unaffected.',
    default: true,
  },
  'suggestions.dueDays': {
    type: 'due_days',
    section: 'suggestions',
    label: 'Due dates for suggested tasks',
    description:
      'How many days a suggested task gets, by how severe the problem is and how important the work is. The agent rates both; an admin can change either before approving, and the due date follows. A due date the note itself states wins. Leave a cell blank for no due date.',
    default: DEFAULT_DUE_DAYS,
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;

export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K] extends { type: 'boolean' }
  ? boolean
  : (typeof SETTINGS)[K] extends { type: 'due_days' }
    ? DueDays
    : (typeof SETTINGS)[K] extends { type: 'checkpoints' }
      ? Checkpoint[]
      : (typeof SETTINGS)[K] extends { type: 'minutes_list' }
        ? number[]
        : (typeof SETTINGS)[K] extends { type: 'membership_ids' }
          ? number[]
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
): { ok: true; value: AnySettingValue } | { ok: false; error: string } {
  const def = settingDefinition(key);
  if (def.type === 'boolean') {
    return typeof raw === 'boolean'
      ? { ok: true, value: raw }
      : { ok: false, error: `${def.label} must be on or off` };
  }
  if (def.type === 'due_days') return parseDueDays(raw);
  if (def.type === 'checkpoints') return parseCheckpoints(raw);
  if (def.type === 'minutes_list') return parseSessionLengths(raw);
  if (def.type === 'membership_ids') return parseMembershipIds(def.label, raw);
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

/** A list of Momence membership ids: whole positive numbers, without repeats, in the order given. */
export function parseMembershipIds(
  label: string,
  raw: unknown
): { ok: true; value: number[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: `${label} must be a list of Momence ids` };
  const bad = raw.find((n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0);
  if (bad !== undefined) {
    return { ok: false, error: `${label}: ${String(bad)} is not a Momence id` };
  }
  const value = [...new Set(raw as number[])];
  if (value.length > MAX_MEMBERSHIP_IDS) {
    return { ok: false, error: `At most ${MAX_MEMBERSHIP_IDS} ids for ${label}` };
  }
  return { ok: true, value };
}

/** An env var's text as a setting's value, or undefined when it doesn't read as one. */
export function parseEnvValue(
  key: SettingKey,
  raw: string | undefined
): AnySettingValue | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const def = settingDefinition(key);
  // A grid or a list has no environment-variable spelling.
  if (def.type === 'due_days' || def.type === 'checkpoints' || def.type === 'minutes_list') {
    return undefined;
  }
  const text = raw.trim().toLowerCase();
  if (def.type === 'membership_ids') {
    // Comma-separated ids, as the env var always held them. Anything that
    // isn't a whole number is skipped, the way the old reader skipped it.
    const ids = text
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const parsed = parseMembershipIds(def.label, ids);
    return parsed.ok ? parsed.value : undefined;
  }
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
  value: AnySettingValue;
  source: SettingSource;
  /** The value it would have without the saved one (env, else default). */
  fallback: AnySettingValue;
  updatedBy: string | null;
  updatedAt: string | null;
}
