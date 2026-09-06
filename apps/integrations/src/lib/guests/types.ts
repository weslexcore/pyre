// Client-safe vocabulary for guest profiles: the field kinds, their labels,
// the limits the forms and the routes agree on, and the small pure helpers
// that turn a stored answer back into words. Nothing in here touches the
// database or Momence — the islands import it, so it must stay bundle-safe.

import type { GuestFieldValue, GuestProfileFieldRow } from '@/lib/db';

/** The page grant that opens /admin/guests. */
export const GUESTS_PAGE = '/admin/guests';

export const FIELD_KINDS = ['choice', 'multi_choice', 'yes_no', 'text', 'number'] as const;
export type GuestFieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<GuestFieldKind, string> = {
  choice: 'Pick one',
  multi_choice: 'Pick any',
  yes_no: 'Yes / no',
  text: 'Short text',
  number: 'Number',
};

export const FIELD_KIND_HINTS: Record<GuestFieldKind, string> = {
  choice: 'One answer from a list you define — "Gentle / Medium / Hot".',
  multi_choice: 'Any number of answers from a list — scents, drinks, activities.',
  yes_no: 'A single yes or no.',
  text: 'A line of free text.',
  number: 'A number, like a temperature or a count.',
};

export function isFieldKind(value: unknown): value is GuestFieldKind {
  return typeof value === 'string' && (FIELD_KINDS as readonly string[]).includes(value);
}

/** Kinds whose answers come from `options`. */
export function kindHasOptions(kind: GuestFieldKind): boolean {
  return kind === 'choice' || kind === 'multi_choice';
}

export const DEFAULT_SECTION = 'About them';

// Limits shared by the forms (maxLength) and the routes (validation) so the
// two never disagree. The database mirrors the ones that matter most.
export const FIELD_LIMITS = {
  key: 40,
  label: 60,
  section: 40,
  hint: 200,
  option: 60,
  optionsPerField: 40,
  summary: 500,
  textAnswer: 500,
  note: 2000,
} as const;

/** A field definition without its bookkeeping columns — what the forms edit. */
export type GuestFieldDefinition = Pick<
  GuestProfileFieldRow,
  'key' | 'label' | 'kind' | 'options' | 'section' | 'hint' | 'show_on_roster'
>;

/**
 * Fields grouped under their section headings, in sort order, sections in
 * the order their first field appears. Archived fields are left out unless
 * a profile still holds an answer for them (`keepKeys`), so an old answer is
 * never silently hidden.
 */
export function groupFields(
  fields: GuestProfileFieldRow[],
  keepKeys: Iterable<string> = []
): { section: string; fields: GuestProfileFieldRow[] }[] {
  const keep = new Set(keepKeys);
  const sorted = [...fields]
    .filter((f) => !f.archived || keep.has(f.key))
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));

  const groups: { section: string; fields: GuestProfileFieldRow[] }[] = [];
  for (const field of sorted) {
    const section = field.section || DEFAULT_SECTION;
    let group = groups.find((g) => g.section === section);
    if (!group) {
      group = { section, fields: [] };
      groups.push(group);
    }
    group.fields.push(field);
  }
  return groups;
}

/** Whether an answer is worth showing — an empty list or blank string is not. */
export function hasAnswer(value: GuestFieldValue | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** A stored answer as the words staff read on a card or a roster. */
export function formatAnswer(field: Pick<GuestProfileFieldRow, 'kind'>, value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (field.kind) {
    case 'yes_no':
      return value === true ? 'Yes' : value === false ? 'No' : '';
    case 'multi_choice':
      return Array.isArray(value) ? value.map(String).join(', ') : String(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    default:
      return typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '';
  }
}

/** One label/answer pair, as the roster and the profile header render it. */
export interface Highlight {
  key: string;
  label: string;
  value: string;
}

/**
 * The answers flagged for the roster, in field order, skipping anything
 * unanswered. Archived fields still count if answered — the flag was set
 * when the answer was — but the roster stays short by construction: only
 * fields an admin marked show_on_roster appear.
 */
export function rosterHighlights(
  fields: GuestProfileFieldRow[],
  values: Record<string, GuestFieldValue> | null | undefined
): Highlight[] {
  if (!values) return [];
  return [...fields]
    .filter((f) => f.show_on_roster && hasAnswer(values[f.key]))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f) => ({ key: f.key, label: f.label, value: formatAnswer(f, values[f.key]) }));
}

/** "Alex Chen" -> "Alex". A chip has room for a first name, not a full one. */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
