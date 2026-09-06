// Request-body normalisation for the guest profile routes. Pure and
// dependency-free so the rules are testable without a database.
//
// Two things are validated here: field *definitions* (what an admin sets up
// on /admin/guests/fields) and field *answers* (what staff write on a
// profile). Answers are checked against the live definitions, so a choice
// that is no longer offered can't be written, and a key nobody defined is
// dropped rather than stored. Dropping rather than rejecting is deliberate:
// two people editing a profile while an admin retires a field should not
// lose the whole save over one stale key.

import type { GuestFieldValue, GuestProfileFieldRow } from '@/lib/db';
import {
  DEFAULT_SECTION,
  FIELD_LIMITS,
  type GuestFieldDefinition,
  type GuestFieldKind,
  isFieldKind,
  kindHasOptions,
} from './types';

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * A stable key from a label: "Scents they enjoy" -> "scents_they_enjoy".
 * Keys are permanent once created (answers hang off them), so this only
 * runs at creation and an explicit key in the body wins when valid.
 */
export function slugifyKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, FIELD_LIMITS.key);
  // Must start with a letter: "5k runners" -> "f_5k_runners".
  return /^[a-z]/.test(slug) ? slug : slug ? `f_${slug}`.slice(0, FIELD_LIMITS.key) : '';
}

/** Trimmed, de-duplicated (case-insensitively), capped option list. */
export function normalizeOptions(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|,/)
      : [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const option = entry.trim().slice(0, FIELD_LIMITS.option);
    if (!option) continue;
    const fold = option.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    options.push(option);
    if (options.length >= FIELD_LIMITS.optionsPerField) break;
  }
  return options;
}

/**
 * A new field definition. The label is the only required input; the key is
 * derived from it unless given, and options are required for the two
 * list-backed kinds.
 */
export function normalizeFieldCreate(
  body: Record<string, unknown>
): Normalized<GuestFieldDefinition> {
  const label = cleanString(body.label, FIELD_LIMITS.label);
  if (!label) return { ok: false, error: `label is required (max ${FIELD_LIMITS.label} chars)` };

  const kind: GuestFieldKind = isFieldKind(body.kind) ? body.kind : 'text';

  const explicitKey = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
  const key = explicitKey || slugifyKey(label);
  if (!KEY_RE.test(key)) {
    return { ok: false, error: 'key must be 2–40 lowercase letters, digits, or underscores' };
  }

  const options = kindHasOptions(kind) ? normalizeOptions(body.options) : [];
  if (kindHasOptions(kind) && options.length < 2) {
    return { ok: false, error: 'Give at least two options to choose from' };
  }

  return {
    ok: true,
    value: {
      key,
      label,
      kind,
      options,
      section: cleanString(body.section, FIELD_LIMITS.section) ?? DEFAULT_SECTION,
      hint: cleanString(body.hint, FIELD_LIMITS.hint),
      show_on_roster: body.show_on_roster === true || body.showOnRoster === true,
    },
  };
}

export type GuestFieldPatch = Partial<
  Pick<
    GuestProfileFieldRow,
    'label' | 'options' | 'section' | 'hint' | 'show_on_roster' | 'archived'
  >
>;

/**
 * An edit to an existing field. Only the keys present in the body are
 * touched; the kind is not editable (answers already stored in one shape
 * would stop making sense in another — retire the field and add a new one).
 */
export function normalizeFieldPatch(
  body: Record<string, unknown>,
  existing: Pick<GuestProfileFieldRow, 'kind'>
): Normalized<GuestFieldPatch> {
  const patch: GuestFieldPatch = {};

  if ('label' in body) {
    const label = cleanString(body.label, FIELD_LIMITS.label);
    if (!label) return { ok: false, error: 'label cannot be blank' };
    patch.label = label;
  }

  if ('options' in body) {
    if (!kindHasOptions(existing.kind)) {
      return { ok: false, error: 'Only pick-one / pick-any fields have options' };
    }
    const options = normalizeOptions(body.options);
    if (options.length < 2) return { ok: false, error: 'Give at least two options to choose from' };
    patch.options = options;
  }

  if ('section' in body) {
    patch.section = cleanString(body.section, FIELD_LIMITS.section) ?? DEFAULT_SECTION;
  }

  if ('hint' in body) patch.hint = cleanString(body.hint, FIELD_LIMITS.hint);

  const roster = 'show_on_roster' in body ? body.show_on_roster : body.showOnRoster;
  if (typeof roster === 'boolean') patch.show_on_roster = roster;

  if (typeof body.archived === 'boolean') patch.archived = body.archived;

  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value: patch };
}

/**
 * One answer, coerced to the field's shape, or null when it is blank or does
 * not fit (a choice that isn't offered, a non-number). Archived fields are
 * still accepted so an old answer can be cleared or corrected.
 */
export function coerceAnswer(
  field: Pick<GuestProfileFieldRow, 'kind' | 'options'>,
  value: unknown
): GuestFieldValue | null {
  if (value === null || value === undefined || value === '') return null;

  switch (field.kind) {
    case 'text': {
      if (typeof value !== 'string') return null;
      const text = value.trim().slice(0, FIELD_LIMITS.textAnswer);
      return text || null;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : null;
    }
    case 'yes_no': {
      if (typeof value === 'boolean') return value;
      if (value === 'yes' || value === 'true') return true;
      if (value === 'no' || value === 'false') return false;
      return null;
    }
    case 'choice': {
      if (typeof value !== 'string') return null;
      const match = field.options.find((o) => o.toLowerCase() === value.trim().toLowerCase());
      return match ?? null;
    }
    case 'multi_choice': {
      const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      const picked: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const match = field.options.find((o) => o.toLowerCase() === entry.trim().toLowerCase());
        if (match && !picked.includes(match)) picked.push(match);
      }
      // Keep the field's own order so two people picking the same set store
      // the same array.
      picked.sort((a, b) => field.options.indexOf(a) - field.options.indexOf(b));
      return picked.length > 0 ? picked : null;
    }
    default:
      return null;
  }
}

/**
 * The answers a save should hold, merged over what is already stored: keys in
 * `input` overwrite (a null/blank clears), keys absent from `input` are kept.
 * Unknown keys are dropped. Returns the full map to store.
 */
export function mergeAnswers(
  fields: Pick<GuestProfileFieldRow, 'key' | 'kind' | 'options'>[],
  current: Record<string, GuestFieldValue> | null | undefined,
  input: unknown
): Record<string, GuestFieldValue> {
  const next: Record<string, GuestFieldValue> = { ...(current ?? {}) };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return next;

  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = byKey.get(key);
    if (!field) continue;
    const value = coerceAnswer(field, raw);
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** The profile summary line: trimmed, capped, null when blank. */
export function normalizeSummary(value: unknown): Normalized<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'summary must be text' };
  const trimmed = value.trim();
  if (trimmed.length > FIELD_LIMITS.summary) {
    return { ok: false, error: `Keep the summary under ${FIELD_LIMITS.summary} characters` };
  }
  return { ok: true, value: trimmed || null };
}

/** A note body: required, trimmed, capped. */
export function normalizeNoteBody(value: unknown): Normalized<string> {
  if (typeof value !== 'string' || !value.trim())
    return { ok: false, error: 'Write something first' };
  const body = value.trim();
  if (body.length > FIELD_LIMITS.note) {
    return { ok: false, error: `Keep a note under ${FIELD_LIMITS.note} characters` };
  }
  return { ok: true, value: body };
}

/** A Momence member id as the routes accept it: digits only. */
export function normalizeMemberId(value: unknown): string | null {
  const text =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  return /^\d{1,20}$/.test(text) ? text : null;
}

/** Field keys in the order given, for a reorder — unknown keys dropped. */
export function normalizeOrder(value: unknown, known: Iterable<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const knownSet = new Set(known);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !knownSet.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    order.push(entry);
  }
  return order.length > 0 ? order : null;
}
