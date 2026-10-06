// Request-body normalization for boards, their columns, and their cards.
// Pure and client-bundle-safe, like the goals half: the forms cap themselves
// at the same numbers the routes reject at.
//
// `created_by`, `updated_by`, `completed_by` and `source` are the route's to
// set from the session; no shape here can reach them. The one exception is
// the intake endpoint, which builds its own insert and stamps 'intake'
// itself — the body it accepts still comes through parseCardCreate.

import type { BoardFieldKind, BoardFieldRow, BoardFieldValue, BoardViewRow } from '@/lib/db';
import { GOAL_LIMITS, isArea } from '@/lib/goals/types';
import {
  type GoalCreate,
  isUuid,
  isYmd,
  numberOf,
  type ParseResult,
  parseGoalCreate,
} from '@/lib/goals/validate';
import { formatChecklist, normalizeChecklist } from './checklist';
import { fileIdsOf, formatFileCount, normalizeFileIds } from './files';
import { formatLinkCount, linkIdsOf, normalizeLinkIds } from './links';
import { isRepeatUnit, REPEAT_EVERY_MAX, type RepeatUnit } from './recurrence';
import type { ColumnKind, FieldKind } from './types';
import {
  answerLimit,
  BOARD_LIMITS,
  isColumnKind,
  isDateUnit,
  isFieldKind,
  isViewGroupBy,
  isViewLayout,
  KEY_RE,
  kindHasOptions,
  kindIsTime,
  SLUG_RE,
  VIEW_SORTS,
} from './types';

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

/**
 * A list of people by email: `assigneeEmails` as an array, or the older
 * single `ownerEmail` (null clears). Lowercased, de-duplicated, order kept.
 * Undefined means the body named nobody either way; a malformed list is
 * reported by the caller.
 */
export function emailList(
  list: unknown,
  single?: unknown
): { ok: true; value: string[] | undefined } | { ok: false } {
  if (list === undefined) {
    if (single === undefined) return { ok: true, value: undefined };
    const one = email(single);
    if (one === undefined) return { ok: false };
    return { ok: true, value: one === null ? [] : [one] };
  }
  if (list === null) return { ok: true, value: [] };
  if (!Array.isArray(list) || list.length > BOARD_LIMITS.assignees) return { ok: false };
  const emails: string[] = [];
  for (const entry of list) {
    const one = email(entry);
    if (!one) return { ok: false };
    if (!emails.includes(one)) emails.push(one);
  }
  return { ok: true, value: emails };
}

/**
 * A repeat rule: `{ every, unit }`, or null to stop repeating. Undefined
 * leaves the card's rule alone.
 */
function parseRepeat(
  value: unknown
):
  | { ok: true; value: { repeat_every: number | null; repeat_unit: RepeatUnit | null } | undefined }
  | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: { repeat_every: null, repeat_unit: null } };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  const rule = value as Record<string, unknown>;
  const every = numberOf(rule.every);
  if (every === undefined || !Number.isInteger(every) || every < 1 || every > REPEAT_EVERY_MAX) {
    return { ok: false };
  }
  if (!isRepeatUnit(rule.unit)) return { ok: false };
  return { ok: true, value: { repeat_every: every, repeat_unit: rule.unit } };
}

export interface ColumnInput {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Who a card moving in is handed to. Absent leaves a saved column's list alone. */
  assignee_emails?: string[];
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

    const assignees = emailList(column.assigneeEmails);
    if (!assignees.ok) {
      return fail(
        `Column "${key}" can be assigned to up to ${BOARD_LIMITS.assignees} email addresses`
      );
    }

    columns.push({
      key,
      label,
      kind: column.kind,
      ...(assignees.value !== undefined ? { assignee_emails: assignees.value } : {}),
      sort_order: order,
      archived: column.archived === true,
    });
  }

  if (!columns.some((column) => column.kind === 'open' && !column.archived)) {
    return fail('A board needs at least one open column');
  }
  return { ok: true, value: columns };
}

/**
 * Slugs that are pages under /admin/boards rather than boards, so a board
 * could never shadow them.
 */
export const RESERVED_BOARD_SLUGS = ['tasks', 'all-goals', 'calendar', 'new'] as const;

export interface FieldInput {
  key: string;
  label: string;
  kind: FieldKind;
  options: string[];
  hint: string | null;
  show_on_card: boolean;
  show_label_on_card: boolean;
  /** Only set for a `date` kind; anything else is coerced to false. */
  show_on_calendar: boolean;
  /** The key of the `time`/`time_range` field that times it, or null. */
  calendar_time_key: string | null;
  /** Only set for a `card_link` kind: the board whose cards answer it. */
  link_board_id: string | null;
  /** Only for `card_link`: column keys on that board a card may be picked from; [] is any. */
  link_columns: string[];
  /** Only for `card_link`: more than one card may be linked. */
  link_multiple: boolean;
  /**
   * Only for `card_link`, and only on the save that asks for it: show the
   * same links on the target board as a field of its own. The route creates
   * that field and pairs the two. Never stored as such.
   */
  link_inverse?: LinkInverseInput;
  /** Only for `checklist`: the default list every card starts from; '' for any other kind. */
  checklist_md: string;
  /** Only for `checklist`: the column key a finished card moves to; null stays put. */
  checklist_done_column: string | null;
  sort_order: number;
  archived: boolean;
}

/** The far half of a two-way link, as the settings panel asks for it. */
export interface LinkInverseInput {
  label: string;
  multiple: boolean;
}

/** Column keys, de-duplicated and shaped like keys; what they name is the route's to check. */
function normalizeColumnKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => KEY_RE.test(entry));
  return [...new Set(keys)];
}

/**
 * The card_link half of a field: which board, which of its columns, one or
 * many, and optionally the far half to create. Null config (every other
 * kind) comes back empty, the way options do for a kind without them.
 */
function parseLinkConfig(
  field: Record<string, unknown>,
  label: string
): ParseResult<
  Pick<FieldInput, 'link_board_id' | 'link_columns' | 'link_multiple' | 'link_inverse'>
> {
  if (field.kind !== 'card_link') {
    return { ok: true, value: { link_board_id: null, link_columns: [], link_multiple: false } };
  }
  // Null only for a field whose board has since been deleted (the column is
  // `on delete set null`); the route refuses it on a field that is new.
  const board = field.linkBoardId ?? null;
  if (board !== null && !isUuid(board)) return fail(`"${label}" needs a board to link cards from`);

  let inverse: LinkInverseInput | undefined;
  if (field.linkInverse !== undefined && field.linkInverse !== null) {
    const raw = field.linkInverse as Record<string, unknown>;
    const inverseLabel = typeof raw === 'object' ? text(raw.label, BOARD_LIMITS.fieldLabel) : null;
    if (!inverseLabel) return fail(`"${label}" needs a name for the field on the other board`);
    inverse = { label: inverseLabel, multiple: raw.multiple !== false };
  }

  return {
    ok: true,
    value: {
      link_board_id: board === null ? null : board.toLowerCase(),
      link_columns: normalizeColumnKeys(field.linkColumns),
      link_multiple: field.linkMultiple === true,
      ...(inverse ? { link_inverse: inverse } : {}),
    },
  };
}

/**
 * The checklist half of a field: its default list and the column a finished
 * card moves to. Which columns the board has is the route's to check; here
 * the key only has to be shaped like one. Every other kind comes back empty.
 */
function parseChecklistConfig(
  field: Record<string, unknown>,
  label: string
): ParseResult<Pick<FieldInput, 'checklist_md' | 'checklist_done_column'>> {
  if (field.kind !== 'checklist') {
    return { ok: true, value: { checklist_md: '', checklist_done_column: null } };
  }
  const raw = field.checklistMd ?? '';
  if (typeof raw !== 'string') return fail(`"${label}" needs its checklist written as text`);
  const md = raw.replace(/\s+$/, '');
  if (md.length > BOARD_LIMITS.checklist) {
    return fail(`"${label}" has a checklist over ${BOARD_LIMITS.checklist} characters`);
  }
  const column =
    typeof field.checklistDoneColumn === 'string' ? field.checklistDoneColumn.trim() : '';
  if (column && !KEY_RE.test(column)) {
    return fail(`"${label}" moves finished cards to a column this board does not have`);
  }
  return { ok: true, value: { checklist_md: md, checklist_done_column: column || null } };
}

/** Trimmed, de-duplicated (case-insensitively), capped option list. */
function normalizeOptions(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|,/)
      : [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const option = entry.trim().slice(0, BOARD_LIMITS.option);
    if (!option) continue;
    const fold = option.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    options.push(option);
    if (options.length >= BOARD_LIMITS.optionsPerField) break;
  }
  return options;
}

/**
 * A board's field list, the way the columns come: whole, keyed, and
 * reconciled by the route. A pick-one or pick-any field needs at least two
 * options or there is nothing to pick between. Kinds are not checked against
 * what is stored — a field may change kind, and the route is what puts the
 * answers already on the cards through the new one.
 */
function parseFields(value: unknown): ParseResult<FieldInput[]> {
  if (!Array.isArray(value)) return fail('fields must be an array');
  if (value.length > BOARD_LIMITS.fieldsPerBoard) {
    return fail(`A board can have ${BOARD_LIMITS.fieldsPerBoard} fields at most`);
  }

  const fields: FieldInput[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') return fail('Each field must be an object');
    const field = raw as Record<string, unknown>;

    const key = typeof field.key === 'string' ? field.key.trim() : '';
    if (!KEY_RE.test(key)) {
      return fail(`Field key "${key}" must be lowercase letters, digits, and underscores`);
    }
    if (seen.has(key)) return fail(`Duplicate field key "${key}"`);
    seen.add(key);

    const label = text(field.label, BOARD_LIMITS.fieldLabel);
    if (!label) return fail(`Field "${key}" needs a label`);
    if (!isFieldKind(field.kind)) return fail(`Field "${key}" has a kind nobody has`);

    const options = kindHasOptions(field.kind) ? normalizeOptions(field.options) : [];
    if (kindHasOptions(field.kind) && options.length < 2) {
      return fail(`Field "${label}" needs at least two options to choose from`);
    }

    const hint = optionalText(field.hint, BOARD_LIMITS.fieldHint);
    if (hint === undefined && field.hint !== undefined) {
      return fail(`Field "${label}" has a hint over ${BOARD_LIMITS.fieldHint} characters`);
    }

    const order = field.sortOrder === undefined ? (index + 1) * 10 : numberOf(field.sortOrder);
    if (order === undefined || !Number.isInteger(order)) {
      return fail(`Field "${key}" has a bad sort order`);
    }

    // Only a date can be an event. A stale client sending the flag on a text
    // field has it dropped rather than refused — the same choice
    // normalizeProperties makes about an answer it cannot use. The pointer
    // that goes with it is dropped too, so the two can never disagree.
    const link = parseLinkConfig(field, label);
    if (!link.ok) return link;
    const checklist = parseChecklistConfig(field, label);
    if (!checklist.ok) return checklist;

    const onCalendar = field.kind === 'date' && field.showOnCalendar === true;
    const timeKey =
      onCalendar && typeof field.calendarTimeKey === 'string'
        ? field.calendarTimeKey.trim() || null
        : null;

    fields.push({
      key,
      label,
      kind: field.kind,
      options,
      hint: hint ?? null,
      show_on_card: field.showOnCard === true,
      // Existing fields have always included their label.
      show_label_on_card: field.showLabelOnCard !== false,
      show_on_calendar: onCalendar,
      calendar_time_key: timeKey,
      ...link.value,
      ...checklist.value,
      sort_order: order,
      archived: field.archived === true,
    });
  }

  // The pairing can only be resolved once the whole list is known, and the
  // whole list always arrives — applyFields reconciles by key, so a save that
  // left a field out is a save that removes it. A *pointer* that goes nowhere
  // is somebody's mistake and is worth a message; a *flag* that is merely
  // meaningless was dropped above without one.
  const byKey = new Map(fields.map((entry) => [entry.key, entry]));
  for (const field of fields) {
    const key = field.calendar_time_key;
    if (key === null) continue;
    if (key === field.key) return fail(`"${field.label}" cannot be timed by itself`);
    const target = byKey.get(key);
    if (!target) return fail(`"${field.label}" is timed by a field this board does not have`);
    if (!kindIsTime(target.kind)) {
      return fail(
        `"${field.label}" must be timed by a time field, and "${target.label}" is not one`
      );
    }
    if (target.archived) {
      return fail(`"${target.label}" is archived, so it cannot time "${field.label}"`);
    }
    // An archived date field draws nothing, so it carries no pointer either.
    if (field.archived) field.calendar_time_key = null;
  }

  return { ok: true, value: fields };
}

export interface BoardCreate {
  slug: string;
  name: string;
  description: string;
  card_noun: string;
  include_in_all_tasks: boolean;
  /** An existing goal to serve, when `goal` is not given. */
  goal_id: string | null;
  /** A goal to create alongside the board and point it at. */
  goal: GoalCreate | null;
  /** The index heading to file it under; null for the unnamed group. */
  section_id: string | null;
  columns: ColumnInput[];
}

/**
 * A goal for a new board: either `goalId` naming one that exists, or `goal`
 * describing one to create. Both is a contradiction; neither is a plain list.
 */
function parseBoardGoal(
  body: Record<string, unknown>
): ParseResult<Pick<BoardCreate, 'goal_id' | 'goal'>> {
  const hasId = body.goalId !== undefined && body.goalId !== null && body.goalId !== '';
  const hasGoal = body.goal !== undefined && body.goal !== null;
  if (hasId && hasGoal) return fail('Send goalId or goal, not both');

  if (hasId) {
    if (!isUuid(body.goalId)) return fail('goalId must be a UUID');
    return { ok: true, value: { goal_id: body.goalId, goal: null } };
  }
  if (hasGoal) {
    if (typeof body.goal !== 'object' || Array.isArray(body.goal)) {
      return fail('goal must be an object');
    }
    const goal = parseGoalCreate(body.goal as Record<string, unknown>);
    if (!goal.ok) return fail(`goal: ${goal.error}`);
    return { ok: true, value: { goal_id: null, goal: goal.value } };
  }
  return { ok: true, value: { goal_id: null, goal: null } };
}

export function parseBoardCreate(body: Record<string, unknown>): ParseResult<BoardCreate> {
  const name = text(body.name, BOARD_LIMITS.name);
  if (!name) return fail(`name must be 1–${BOARD_LIMITS.name} characters`);

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) {
    return fail(
      'slug must start with a letter and hold only lowercase letters, digits, and dashes'
    );
  }
  if ((RESERVED_BOARD_SLUGS as readonly string[]).includes(slug)) {
    return fail(`"${slug}" is a page of the tool, not a board`);
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

  const goal = parseBoardGoal(body);
  if (!goal.ok) return goal;

  let sectionId: string | null = null;
  if (body.sectionId !== undefined && body.sectionId !== null && body.sectionId !== '') {
    if (!isUuid(body.sectionId)) return fail('sectionId must be a UUID');
    sectionId = body.sectionId;
  }

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
      ...goal.value,
      section_id: sectionId,
      columns: columns.value,
    },
  };
}

export interface BoardPatch {
  name?: string;
  description?: string;
  card_noun?: string;
  include_in_all_tasks?: boolean;
  default_assignee_emails?: string[];
  due_on_calendar?: boolean;
  archived?: boolean;
  sort_order?: number;
  /** Absent leaves the goal alone; null detaches it. */
  goal_id?: string | null;
  /** Absent leaves the section alone; null moves it to the unnamed group. */
  section_id?: string | null;
  /** Absent leaves the columns alone; present replaces the whole list. */
  columns?: ColumnInput[];
  /** Absent leaves the fields alone; present replaces the whole list. */
  fields?: FieldInput[];
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

  if (body.defaultAssigneeEmails !== undefined) {
    const assignees = emailList(body.defaultAssigneeEmails);
    if (!assignees.ok || assignees.value === undefined) {
      return fail(`defaultAssigneeEmails must be up to ${BOARD_LIMITS.assignees} email addresses`);
    }
    patch.default_assignee_emails = assignees.value;
  }

  if (body.dueOnCalendar !== undefined) {
    if (typeof body.dueOnCalendar !== 'boolean') {
      return fail('dueOnCalendar must be true or false');
    }
    patch.due_on_calendar = body.dueOnCalendar;
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

  if (body.goalId !== undefined) {
    if (body.goalId === null || body.goalId === '') patch.goal_id = null;
    else if (!isUuid(body.goalId)) return fail('goalId must be a UUID or null');
    else patch.goal_id = body.goalId;
  }

  if (body.sectionId !== undefined) {
    if (body.sectionId === null || body.sectionId === '') patch.section_id = null;
    else if (!isUuid(body.sectionId)) return fail('sectionId must be a UUID or null');
    else patch.section_id = body.sectionId;
  }

  if (body.columns !== undefined) {
    const columns = parseColumns(body.columns);
    if (!columns.ok) return columns;
    patch.columns = columns.value;
  }

  if (body.fields !== undefined) {
    const fields = parseFields(body.fields);
    if (!fields.ok) return fields;
    patch.fields = fields.value;
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to change');
  return { ok: true, value: patch };
}

const REPEAT_ERROR = `repeat must be null or { every: 1–${REPEAT_EVERY_MAX}, unit: day, week, month, or year }`;

export interface CardCreate {
  board_id?: string;
  column_id: string | null;
  title: string;
  notes_md: string;
  /** Empty takes the column's assignees, then the board's defaults (the insert trigger). */
  assignee_emails: string[];
  due_date: string | null;
  repeat_every: number | null;
  repeat_unit: RepeatUnit | null;
  waiting_on: string | null;
  area: string | null;
  properties: Record<string, BoardFieldValue>;
}

/**
 * A new card. `columnId` is optional — a quick-add from All Tasks doesn't
 * pick one, and the route drops it in the board's first open column. The
 * goal is never in the body: a card is filed under its board's goal, and the
 * route sets that. `properties` is normalized against the board's fields by
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

  let notes = '';
  if (body.notesMd !== undefined && body.notesMd !== null) {
    if (typeof body.notesMd !== 'string') return fail('notesMd must be text');
    notes = body.notesMd.trim();
    if (notes.length > BOARD_LIMITS.notes) {
      return fail(`notesMd must be ${BOARD_LIMITS.notes} characters or fewer`);
    }
  }

  const assignees = emailList(body.assigneeEmails, body.ownerEmail);
  if (!assignees.ok) {
    return fail(`assigneeEmails must be up to ${BOARD_LIMITS.assignees} email addresses`);
  }

  const repeat = parseRepeat(body.repeat);
  if (!repeat.ok) return fail(REPEAT_ERROR);

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
      title,
      notes_md: notes,
      assignee_emails: assignees.value ?? [],
      due_date: dueDate,
      repeat_every: repeat.value?.repeat_every ?? null,
      repeat_unit: repeat.value?.repeat_unit ?? null,
      waiting_on: waiting ?? null,
      area: area ?? null,
      properties: {},
    },
  };
}

export interface CardPatch {
  column_id?: string;
  title?: string;
  notes_md?: string;
  assignee_emails?: string[];
  due_date?: string | null;
  repeat_every?: number | null;
  repeat_unit?: RepeatUnit | null;
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

  if (body.notesMd !== undefined) {
    if (typeof body.notesMd !== 'string') return fail('notesMd must be text');
    const notes = body.notesMd.trim();
    if (notes.length > BOARD_LIMITS.notes) {
      return fail(`notesMd must be ${BOARD_LIMITS.notes} characters or fewer`);
    }
    patch.notes_md = notes;
  }

  const assignees = emailList(body.assigneeEmails, body.ownerEmail);
  if (!assignees.ok) {
    return fail(`assigneeEmails must be up to ${BOARD_LIMITS.assignees} email addresses`);
  }
  if (assignees.value !== undefined) patch.assignee_emails = assignees.value;

  const repeat = parseRepeat(body.repeat);
  if (!repeat.ok) return fail(REPEAT_ERROR);
  if (repeat.value) Object.assign(patch, repeat.value);

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

/** Venue-local wall-clock time, 24h `HH:MM`. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return TIME_RE.test(value) ? value : null;
}

/**
 * An address, lowercased, or null. Deliberately not the full RFC: one @,
 * something either side, a dot in the domain, no spaces. That is the check
 * worth making at the door — whether the address exists is answered by
 * sending to it, not by a regular expression.
 */
export function emailOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) ? value : null;
}

/**
 * A phone number as +<country><digits>, or null. What people type is full
 * of brackets, dots, spaces and dashes, so only the digits are read: ten of
 * them is a North American number, eleven starting with 1 is the same
 * number said longer, and anything written with a leading + is taken as
 * already saying its own country.
 */
export function phoneOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** '+12125551234' as '(212) 555-1234'; anything else as it is stored. */
export function formatPhone(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value;
}

/**
 * What to say when something was typed into a field that cannot hold it.
 * Only the kinds that are a rule about their text: a pick-one whose option
 * the board has since dropped is our mess, not the typist's, and is quietly
 * left behind. Shared so the form and the card drawer say the same thing.
 */
export const KIND_PROBLEMS: Partial<Record<BoardFieldKind, string>> = {
  email: 'That does not look like an email address.',
  phone: 'That does not look like a phone number.',
};

/** One answer, coerced to the shape its field's kind stores. */
export function normalizeAnswer(
  field: Pick<BoardFieldRow, 'kind' | 'options'>,
  raw: unknown
): BoardFieldValue | null {
  const kind: BoardFieldKind = field.kind;
  switch (kind) {
    case 'email':
      return emailOf(raw);
    case 'phone':
      return phoneOf(raw);
    case 'yes_no':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return null;
    case 'number': {
      const parsed = numberOf(raw);
      return parsed === undefined ? null : parsed;
    }
    case 'time':
      return timeOf(raw);
    case 'time_range': {
      // Both ends or nothing: a window with one edge is not a window, and
      // storing half would leave the card showing a time that means nothing.
      // The order is not checked — a party that runs past midnight ends
      // "before" it starts.
      if (!Array.isArray(raw) || raw.length !== 2) return null;
      const start = timeOf(raw[0]);
      const end = timeOf(raw[1]);
      return start && end ? [start, end] : null;
    }
    case 'date': {
      if (!Array.isArray(raw)) {
        return typeof raw === 'string' && isYmd(raw.trim()) ? raw.trim() : null;
      }
      const dates = [
        ...new Set(
          raw
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(isYmd)
        ),
      ];
      return dates.length > 0 ? dates : null;
    }
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
    case 'files':
      // Shaped here, settled by the route: an id that names no row on this
      // board is dropped there (card-media.ts), the way a pick-one that is
      // no longer on the list is dropped here.
      return normalizeFileIds(raw);
    case 'card_link':
      // Shaped here, settled by the route (card-links.ts): which cards the
      // field may link, and how many, needs the database.
      return normalizeLinkIds(raw);
    case 'checklist':
      // Shaped here; who resolved each item is stamped by the route
      // (checklist.ts stampChecklists), never taken from the request.
      return normalizeChecklist(raw);
    default: {
      if (typeof raw !== 'string') return null;
      // A long text keeps its line breaks — they are how a paragraph is a
      // paragraph — while the trailing whitespace of an unfinished thought
      // goes, the way it does for every other typed answer.
      const value = raw.trim();
      return value ? value.slice(0, answerLimit(kind)) : null;
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

/** '18:30' as '6:30 PM'; '' for anything that is not a stored time. */
function formatTime(value: unknown): string {
  if (typeof value !== 'string' || !TIME_RE.test(value)) return '';
  const [hour, minute] = value.split(':');
  const hours = Number(hour);
  return `${hours % 12 || 12}:${minute} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * '2026-10-03' as '10.03.26' — the house format for a calendar day, month
 * first and padded, short enough to sit in a card row's property line and
 * the same width whatever the date. Anything that is not a stored date
 * comes back as it went in, so a value from before the field was a date
 * still reads as itself.
 */
export function formatYmd(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${month}.${day}.${year.slice(2)}`;
}

/** A stored answer as the words a card shows. */
export function formatProperty(field: Pick<BoardFieldRow, 'kind'>, value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (field.kind) {
    case 'yes_no':
      return value === true ? 'Yes' : value === false ? 'No' : '';
    case 'date':
      // One date, or the several a form may collect.
      return Array.isArray(value) ? value.map(formatYmd).join(', ') : formatYmd(value);
    case 'phone':
      return formatPhone(value);
    case 'long_text':
      // A card row is one line: the paragraphs are read in the drawer, and
      // what the row shows is the same words with the breaks closed up.
      return typeof value === 'string' ? value.replace(/\s+/g, ' ') : '';
    case 'time':
      return formatTime(value);
    case 'time_range': {
      if (!Array.isArray(value) || value.length !== 2) return '';
      const start = formatTime(value[0]);
      const end = formatTime(value[1]);
      return start && end ? `${start} – ${end}` : '';
    }
    case 'multi_choice':
      return Array.isArray(value) ? value.map(String).join(', ') : String(value);
    case 'files': {
      // The card shows a count; the drawer, with the rows in hand, shows names.
      const count = fileIdsOf(value).length;
      return count > 0 ? formatFileCount(count) : '';
    }
    case 'card_link': {
      // Ids are all an answer holds; the row and drawer, with the linked
      // cards' summaries in hand, show titles instead.
      const count = linkIdsOf(value).length;
      return count > 0 ? formatLinkCount(count) : '';
    }
    case 'checklist':
      return formatChecklist(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    default:
      return typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '';
  }
}

// ---------------------------------------------------------------------------
// Saved views. Shape only: whether the field a view names exists on the
// board, and is a kind it can group or sort by, is viewProblem's to say
// (lib/boards/views.ts), with the board's fields in hand.

/** A view's columns as a write sets them. */
export interface ViewPatch {
  name?: string;
  group_by?: BoardViewRow['group_by'];
  group_field_key?: string | null;
  date_unit?: BoardViewRow['date_unit'];
  layout?: BoardViewRow['layout'];
  sort_by?: string;
  hide_finished?: boolean;
  show_empty?: boolean;
  show_status?: boolean;
}

function viewSort(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if ((VIEW_SORTS as readonly string[]).includes(value)) return value;
  const key = value.startsWith('field:') ? value.slice('field:'.length) : '';
  return KEY_RE.test(key) ? value : undefined;
}

/**
 * A view's settings, from `{ name, groupBy, groupFieldKey, dateUnit, layout,
 * sortBy, hideFinished, showEmpty, showStatus }`. A create needs a name and a grouping;
 * a patch takes whatever it is given. Changing the grouping to a built-in
 * clears the field it named.
 */
export function parseViewInput(
  body: Record<string, unknown>,
  { create }: { create: boolean }
): ParseResult<ViewPatch> {
  const patch: ViewPatch = {};

  if (body.name !== undefined || create) {
    const name = text(body.name, BOARD_LIMITS.viewName);
    if (!name) return fail(`A view needs a name of up to ${BOARD_LIMITS.viewName} characters`);
    patch.name = name;
  }

  if (body.groupBy !== undefined || create) {
    if (!isViewGroupBy(body.groupBy)) {
      return fail('groupBy must be column, assignee, due_date, created_at, or field');
    }
    patch.group_by = body.groupBy;
    if (body.groupBy === 'field') {
      const key = typeof body.groupFieldKey === 'string' ? body.groupFieldKey.trim() : '';
      if (!KEY_RE.test(key)) return fail('Pick the field this view groups by');
      patch.group_field_key = key;
    } else {
      patch.group_field_key = null;
    }
  }

  if (body.dateUnit !== undefined) {
    if (body.dateUnit !== null && !isDateUnit(body.dateUnit)) {
      return fail('dateUnit must be day, week, month, or year');
    }
    patch.date_unit = body.dateUnit;
  }

  if (body.layout !== undefined) {
    if (!isViewLayout(body.layout)) return fail('layout must be sections or lanes');
    patch.layout = body.layout;
  }

  if (body.sortBy !== undefined) {
    const sort = viewSort(body.sortBy);
    if (!sort) return fail('sortBy must be manual, due_date, title, created_at, or field:<key>');
    patch.sort_by = sort;
  }

  for (const [input, column] of [
    ['hideFinished', 'hide_finished'],
    ['showEmpty', 'show_empty'],
    ['showStatus', 'show_status'],
  ] as const) {
    if (body[input] === undefined) continue;
    if (typeof body[input] !== 'boolean') return fail(`${input} must be true or false`);
    patch[column] = body[input];
  }

  return { ok: true, value: patch };
}
