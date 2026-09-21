// Request-body normalization for boards, their columns, and their cards.
// Pure and client-bundle-safe, like the goals half: the forms cap themselves
// at the same numbers the routes reject at.
//
// `created_by`, `updated_by`, `completed_by` and `source` are the route's to
// set from the session; no shape here can reach them. The one exception is
// the intake endpoint, which builds its own insert and stamps 'intake'
// itself — the body it accepts still comes through parseCardCreate.

import type { BoardFieldKind, BoardFieldRow, BoardFieldValue } from '@/lib/db';
import { isYmd, isUuid, numberOf, type ParseResult } from '@/lib/goals/validate';
import { GOAL_LIMITS, isArea } from '@/lib/goals/types';
import { BOARD_LIMITS, KEY_RE, SLUG_RE, isColumnKind } from './types';
import type { ColumnKind } from './types';

export type { ParseResult };

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
}

function email(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.length >= 3 && trimmed.length <= 320 ? trimmed : undefined;
}

export interface ColumnInput {
  key: string;
  label: string;
  kind: ColumnKind;
  sort_order: number;
  archived: boolean;
}

/**
 * A board's column list. At least one open column, or the board is a wall of
 * finished work with nowhere to put anything new; keys unique, because
 * `unique (board_id, key)` will say so anyway and a clear message beats a
 * constraint violation.
 */
function parseColumns(value: unknown): ParseResult<ColumnInput[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('columns must be a non-empty array');
  }
  if (value.length > 20) return fail('A board can have 20 columns at most');

  const columns: ColumnInput[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') return fail('Each column must be an object');
    const column = raw as Record<string, unknown>;

    const key = typeof column.key === 'string' ? column.key.trim() : '';
    if (!KEY_RE.test(key)) {
      return fail(`Column key "${key}" must be lowercase letters, digits, and underscores`);
    }
    if (seen.has(key)) return fail(`Duplicate column key "${key}"`);
    seen.add(key);

    const label = text(column.label, BOARD_LIMITS.columnLabel);
    if (!label) return fail(`Column "${key}" needs a label`);
    if (!isColumnKind(column.kind)) {
      return fail(`Column "${key}" must be open, done, or dropped`);
    }

    const order = column.sortOrder === undefined ? (index + 1) * 10 : numberOf(column.sortOrder);
    if (order === undefined || !Number.isInteger(order)) {
      return fail(`Column "${key}" has a bad sort order`);
    }

    columns.push({
      key,
      label,
      kind: column.kind,
      sort_order: order,
      archived: column.archived === true,
    });
  }

  if (!columns.some((column) => column.kind === 'open' && !column.archived)) {
    return fail('A board needs at least one open column');
  }
  return { ok: true, value: columns };
}

export interface BoardCreate {
  slug: string;
  name: string;
  description: string;
  card_noun: string;
  include_in_all_tasks: boolean;
  columns: ColumnInput[];
}

export function parseBoardCreate(body: Record<string, unknown>): ParseResult<BoardCreate> {
  const name = text(body.name, BOARD_LIMITS.name);
  if (!name) return fail(`name must be 1–${BOARD_LIMITS.name} characters`);

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) {
    return fail('slug must start with a letter and hold only lowercase letters, digits, and dashes');
  }

  let description = '';
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') return fail('description must be text');
    description = body.description.trim();
    if (description.length > BOARD_LIMITS.description) {
      return fail(`description must be ${BOARD_LIMITS.description} characters or fewer`);
    }
  }

  const noun = body.cardNoun === undefined ? 'task' : text(body.cardNoun, BOARD_LIMITS.cardNoun);
  if (!noun) return fail(`cardNoun must be 1–${BOARD_LIMITS.cardNoun} characters`);

  const columns = parseColumns(body.columns);
  if (!columns.ok) return columns;

  return {
    ok: true,
    value: {
      slug,
      name,
      description,
      card_noun: noun,
      include_in_all_tasks: body.includeInAllTasks !== false,
      columns: columns.value,
    },
  };
}

export interface BoardPatch {
  name?: string;
  description?: string;
  card_noun?: string;
  include_in_all_tasks?: boolean;
  archived?: boolean;
  sort_order?: number;
  /** Absent leaves the columns alone; present replaces the whole list. */
  columns?: ColumnInput[];
}

export function parseBoardPatch(body: Record<string, unknown>): ParseResult<BoardPatch> {
  const patch: BoardPatch = {};

  if (body.name !== undefined) {
    const name = text(body.name, BOARD_LIMITS.name);
    if (!name) return fail(`name must be 1–${BOARD_LIMITS.name} characters`);
    patch.name = name;
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') return fail('description must be text');
    const description = body.description.trim();
    if (description.length > BOARD_LIMITS.description) {
      return fail(`description must be ${BOARD_LIMITS.description} characters or fewer`);
    }
    patch.description = description;
  }

  if (body.cardNoun !== undefined) {
    const noun = text(body.cardNoun, BOARD_LIMITS.cardNoun);
    if (!noun) return fail(`cardNoun must be 1–${BOARD_LIMITS.cardNoun} characters`);
    patch.card_noun = noun;
  }

  if (body.includeInAllTasks !== undefined) {
    if (typeof body.includeInAllTasks !== 'boolean') {
      return fail('includeInAllTasks must be true or false');
    }
    patch.include_in_all_tasks = body.includeInAllTasks;
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') return fail('archived must be true or false');
    patch.archived = body.archived;
  }

  if (body.sortOrder !== undefined) {
    const order = numberOf(body.sortOrder);
    if (order === undefined || !Number.isInteger(order)) {
      return fail('sortOrder must be a whole number');
    }
    patch.sort_order = order;
  }

  if (body.columns !== undefined) {
    const columns = parseColumns(body.columns);
    if (!columns.ok) return columns;
    patch.columns = columns.value;
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to change');
  return { ok: true, value: patch };
}

export interface CardCreate {
  board_id?: string;
  column_id: string | null;
  goal_id: string | null;
  title: string;
  notes_md: string;
  owner_email: string | null;
  due_date: string | null;
  waiting_on: string | null;
  area: string | null;
  properties: Record<string, BoardFieldValue>;
}

/**
 * A new card. `columnId` is optional — a quick-add from a goal page or the
 * unfiled section doesn't pick one, and the route drops it in the board's
 * first open column. `properties` is normalized against the board's fields by
 * the caller (see normalizeProperties) once it knows which board this is.
 */
export function parseCardCreate(body: Record<string, unknown>): ParseResult<CardCreate> {
  const title = text(body.title, BOARD_LIMITS.title);
  if (!title) return fail(`title must be 1–${BOARD_LIMITS.title} characters`);

  let columnId: string | null = null;
  if (body.columnId !== undefined && body.columnId !== null && body.columnId !== '') {
    if (!isUuid(body.columnId)) return fail('columnId must be a UUID');
    columnId = body.columnId;
  }

  let goalId: string | null = null;
  if (body.goalId !== undefined && body.goalId !== null && body.goalId !== '') {
    if (!isUuid(body.goalId)) return fail('goalId must be a UUID');
    goalId = body.goalId;
  }

  let notes = '';
  if (body.notesMd !== undefined && body.notesMd !== null) {
    if (typeof body.notesMd !== 'string') return fail('notesMd must be text');
    notes = body.notesMd.trim();
    if (notes.length > BOARD_LIMITS.notes) {
      return fail(`notesMd must be ${BOARD_LIMITS.notes} characters or fewer`);
    }
  }

  const owner = email(body.ownerEmail);
  if (owner === undefined && body.ownerEmail !== undefined) {
    return fail('ownerEmail must be an email address');
  }

  let dueDate: string | null = null;
  if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
    if (!isYmd(body.dueDate)) return fail('dueDate must be a YYYY-MM-DD date');
    dueDate = body.dueDate;
  }

  const waiting = optionalText(body.waitingOn, BOARD_LIMITS.waitingOn);
  if (waiting === undefined && body.waitingOn !== undefined) {
    return fail(`waitingOn must be ${BOARD_LIMITS.waitingOn} characters or fewer`);
  }

  const area = optionalText(body.area, GOAL_LIMITS.area);
  if (area === undefined && body.area !== undefined) {
    return fail(`area must be ${GOAL_LIMITS.area} characters or fewer`);
  }
  if (area && !isArea(area)) return fail('area is not one of the known areas');

  if (body.properties !== undefined && body.properties !== null) {
    if (typeof body.properties !== 'object' || Array.isArray(body.properties)) {
      return fail('properties must be an object');
    }
  }

  return {
    ok: true,
    value: {
      column_id: columnId,
      goal_id: goalId,
      title,
      notes_md: notes,
      owner_email: owner ?? null,
      due_date: dueDate,
      waiting_on: waiting ?? null,
      area: area ?? null,
      properties: {},
    },
  };
}

export interface CardPatch {
  column_id?: string;
  goal_id?: string | null;
  title?: string;
  notes_md?: string;
  owner_email?: string | null;
  due_date?: string | null;
  waiting_on?: string | null;
  area?: string | null;
  sort_order?: number;
  properties?: Record<string, BoardFieldValue>;
}

export function parseCardPatch(body: Record<string, unknown>): ParseResult<CardPatch> {
  const patch: CardPatch = {};

  if (body.title !== undefined) {
    const title = text(body.title, BOARD_LIMITS.title);
    if (!title) return fail(`title must be 1–${BOARD_LIMITS.title} characters`);
    patch.title = title;
  }

  if (body.columnId !== undefined) {
    if (!isUuid(body.columnId)) return fail('columnId must be a UUID');
    patch.column_id = body.columnId;
  }

  if (body.goalId !== undefined) {
    if (body.goalId === null || body.goalId === '') patch.goal_id = null;
    else if (!isUuid(body.goalId)) return fail('goalId must be a UUID or null');
    else patch.goal_id = body.goalId;
  }

  if (body.notesMd !== undefined) {
    if (typeof body.notesMd !== 'string') return fail('notesMd must be text');
    const notes = body.notesMd.trim();
    if (notes.length > BOARD_LIMITS.notes) {
      return fail(`notesMd must be ${BOARD_LIMITS.notes} characters or fewer`);
    }
    patch.notes_md = notes;
  }

  if (body.ownerEmail !== undefined) {
    const owner = email(body.ownerEmail);
    if (owner === undefined) return fail('ownerEmail must be an email address or null');
    patch.owner_email = owner;
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === '') patch.due_date = null;
    else if (!isYmd(body.dueDate)) return fail('dueDate must be a YYYY-MM-DD date or null');
    else patch.due_date = body.dueDate;
  }

  if (body.waitingOn !== undefined) {
    const waiting = optionalText(body.waitingOn, BOARD_LIMITS.waitingOn);
    if (waiting === undefined) {
      return fail(`waitingOn must be ${BOARD_LIMITS.waitingOn} characters or fewer`);
    }
    patch.waiting_on = waiting;
  }

  if (body.area !== undefined) {
    const area = optionalText(body.area, GOAL_LIMITS.area);
    if (area === undefined) return fail(`area must be ${GOAL_LIMITS.area} characters or fewer`);
    if (area && !isArea(area)) return fail('area is not one of the known areas');
    patch.area = area;
  }

  if (body.sortOrder !== undefined) {
    const order = numberOf(body.sortOrder);
    if (order === undefined || !Number.isInteger(order)) {
      return fail('sortOrder must be a whole number');
    }
    patch.sort_order = order;
  }

  if (body.properties !== undefined) {
    if (!body.properties || typeof body.properties !== 'object' || Array.isArray(body.properties)) {
      return fail('properties must be an object');
    }
  }

  if (Object.keys(patch).length === 0 && body.properties === undefined) {
    return fail('Nothing to change');
  }
  return { ok: true, value: patch };
}

/** One answer, coerced to the shape its field's kind stores. */
function normalizeAnswer(field: Pick<BoardFieldRow, 'kind' | 'options'>, raw: unknown): BoardFieldValue | null {
  const kind: BoardFieldKind = field.kind;
  switch (kind) {
    case 'yes_no':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return null;
    case 'number': {
      const parsed = numberOf(raw);
      return parsed === undefined ? null : parsed;
    }
    case 'date':
      return typeof raw === 'string' && isYmd(raw.trim()) ? raw.trim() : null;
    case 'choice': {
      if (typeof raw !== 'string') return null;
      const value = raw.trim();
      // An answer that is no longer on the list is dropped rather than kept:
      // the point of a pick-one is that the card says one of the things the
      // board offers.
      return value && field.options.includes(value) ? value : null;
    }
    case 'multi_choice': {
      if (!Array.isArray(raw)) return null;
      const picked = raw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => field.options.includes(item));
      return picked.length > 0 ? [...new Set(picked)] : null;
    }
    default: {
      if (typeof raw !== 'string') return null;
      const value = raw.trim();
      return value ? value.slice(0, BOARD_LIMITS.textAnswer) : null;
    }
  }
}

/**
 * A card's answers, checked against the board's own fields. Unknown keys are
 * dropped rather than rejected — the same choice guest profiles make, so a
 * card written under last month's field list still saves — and an unusable
 * answer clears the key instead of storing a half-value.
 *
 * `previous` is the card's current properties, so a PATCH that mentions only
 * one field leaves the rest alone.
 */
export function normalizeProperties(
  fields: Pick<BoardFieldRow, 'key' | 'kind' | 'options'>[],
  raw: unknown,
  previous: Record<string, BoardFieldValue> = {}
): Record<string, BoardFieldValue> {
  const next: Record<string, BoardFieldValue> = { ...previous };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next;

  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = byKey.get(key);
    if (!field) continue;
    const answer = value === null ? null : normalizeAnswer(field, value);
    if (answer === null) delete next[key];
    else next[key] = answer;
  }
  return next;
}

/** A stored answer as the words a card shows. */
export function formatProperty(field: Pick<BoardFieldRow, 'kind'>, value: unknown): string {
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
