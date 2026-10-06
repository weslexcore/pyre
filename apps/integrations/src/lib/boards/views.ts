// Saved views: a board's cards grouped by something other than the column
// they sit in. Pure and client-safe — the board island groups the cards it
// already holds, so a view costs no request of its own.
//
// Each grouping reads a card into zero or more buckets. A card with several
// answers — two practitioners, a form's several dates, three of a
// multi-choice's options — sits in each of their groups, the way a card on
// two people sits on both their lists in All Tasks. A card with no answer
// goes in the grouping's empty bucket, which always comes last.
//
// The buckets are read through the shapes normalizeAnswer stores, and a
// missing key is no answer. Labels are the words a card row shows for the
// same value (formatProperty), so a group reads the way its cards do.

import { easternDate } from '@pyre/schedule-core';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardViewRow } from '@/lib/db';
import { isYmd } from '@/lib/goals/validate';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { formatMonth, monthStartOf, sundayStartOf } from './calendar';
import { isFinished } from './cards';
import { checklistDone, checklistOf, formatChecklist } from './checklist';
import { fileIdsOf } from './files';
import { type LinkSummary, linkIdsOf } from './links';
import {
  BOARD_LIMITS,
  type DateUnit,
  type FieldKind,
  GROUPABLE_KINDS,
  SORTABLE_KINDS,
} from './types';
import { formatProperty } from './validate';

/** What grouping a view needs from its row. */
export type ViewSpec = Pick<
  BoardViewRow,
  'group_by' | 'group_field_key' | 'date_unit' | 'sort_by' | 'hide_finished' | 'show_empty'
>;

export interface ViewGroup<C> {
  key: string;
  label: string;
  /** Under the label: a linked card's board and column. */
  sublabel?: string;
  cards: C[];
}

export type ViewResult<C> =
  | { ok: true; groups: ViewGroup<C>[] }
  /** The view groups by a field the board no longer has (deleted or archived). */
  | { ok: false; reason: 'missing_field' };

export interface ViewInput<C> {
  cards: C[];
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  people?: PeopleNames;
  /** Linked cards' summaries by id (summariesById), for a link grouping's titles. */
  links?: Map<string, LinkSummary>;
  /** Their own group first, when grouping by assignee. */
  viewerEmail?: string;
}

type ViewCard = Pick<
  BoardCardRow,
  | 'id'
  | 'column_id'
  | 'title'
  | 'assignee_emails'
  | 'due_date'
  | 'properties'
  | 'sort_order'
  | 'created_at'
>;

/** One group a card lands in. `order` sorts groups (as text); the empty bucket has none. */
interface Bucket {
  key: string;
  label: string;
  sublabel?: string;
  order: string;
}

interface Grouping<C> {
  bucketsOf: (card: C) => Bucket[];
  /** Groups that exist whether or not a card is in them, for show_empty. */
  known: Bucket[];
  /** Where a card with no answer goes; null when every card has one. */
  emptyLabel: string | null;
  /** Compare two group orders; text by default. */
  compare?: (a: string, b: string) => number;
}

const EMPTY = '__empty__';

const byText = (a: string, b: string) => a.localeCompare(b);

/** The fields a view can group by, in board order. */
export function groupableFields(fields: BoardFieldRow[]): BoardFieldRow[] {
  return fields
    .filter((field) => !field.archived && GROUPABLE_KINDS.includes(field.kind))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** The fields a view can sort a group by. */
export function sortableFields(fields: BoardFieldRow[]): BoardFieldRow[] {
  return groupableFields(fields).filter((field) => SORTABLE_KINDS.includes(field.kind));
}

/** Whether a grouping buckets by date, and so takes a day/week/month/year unit. */
export function groupsByDate(
  groupBy: BoardViewRow['group_by'],
  kind: FieldKind | undefined
): boolean {
  return (
    groupBy === 'due_date' || groupBy === 'created_at' || (groupBy === 'field' && kind === 'date')
  );
}

/** The settings a new view starts from, as POST /api/admin/board-views takes them. */
export interface NewViewBody {
  name: string;
  groupBy: BoardViewRow['group_by'];
  groupFieldKey: string | null;
  dateUnit: DateUnit | null;
  sortBy: string;
}

/**
 * What "+ View" makes before anyone has picked anything: the board's first
 * date field by month, sorted by that date, since "what is on when" is what
 * a board with dates gets asked first; and by assignee on a board without
 * one, the other question its columns cannot answer. The view is saved as
 * soon as it is made, and changed from there.
 */
export function newViewDefaults(fields: BoardFieldRow[]): NewViewBody {
  const date = groupableFields(fields).find((field) => field.kind === 'date');
  if (date) {
    return {
      name: `By ${date.label.toLowerCase()}`.slice(0, BOARD_LIMITS.viewName),
      groupBy: 'field',
      groupFieldKey: date.key,
      dateUnit: 'month',
      sortBy: `field:${date.key}`,
    };
  }
  return {
    name: 'By assignee',
    groupBy: 'assignee',
    groupFieldKey: null,
    dateUnit: null,
    sortBy: 'manual',
  };
}

/**
 * What is wrong with a view's settings against this board's fields, or null.
 * A date unit goes with a date grouping and only there; a field sort names a
 * date, number, or time field the board still has.
 */
export function viewProblem(
  view: Pick<BoardViewRow, 'group_by' | 'group_field_key' | 'date_unit' | 'sort_by'>,
  fields: BoardFieldRow[]
): string | null {
  let kind: FieldKind | undefined;
  if (view.group_by === 'field') {
    const field = groupableFields(fields).find((f) => f.key === view.group_field_key);
    if (!field) return 'That field is not one this board can group by';
    kind = field.kind;
  }
  const dated = groupsByDate(view.group_by, kind);
  if (dated && !view.date_unit) return 'Pick day, week, month, or year';
  if (!dated && view.date_unit) return 'Only a date grouping takes a day, week, month, or year';
  if (view.sort_by.startsWith('field:')) {
    const key = view.sort_by.slice('field:'.length);
    if (!sortableFields(fields).some((f) => f.key === key)) {
      return 'A view sorts by a date, number, or time field on this board';
    }
  }
  return null;
}

/**
 * A board's cards, filtered and grouped the way the view says, groups in
 * order and cards in order within each.
 */
export function groupCards<C extends ViewCard>(view: ViewSpec, input: ViewInput<C>): ViewResult<C> {
  const field =
    view.group_by === 'field'
      ? input.fields.find((f) => f.key === view.group_field_key && !f.archived)
      : undefined;
  if (view.group_by === 'field' && (!field || !GROUPABLE_KINDS.includes(field.kind))) {
    return { ok: false, reason: 'missing_field' };
  }

  const columnsById = new Map(input.columns.map((column) => [column.id, column]));
  const cards = view.hide_finished
    ? input.cards.filter((card) => !isFinished(card, columnsById))
    : input.cards;

  const grouping = groupingFor<C>(view, field, input);
  const groups = new Map<string, Bucket & { cards: C[] }>();
  const add = (bucket: Bucket, card?: C) => {
    let group = groups.get(bucket.key);
    if (!group) {
      group = { ...bucket, cards: [] };
      groups.set(bucket.key, group);
    }
    if (card) group.cards.push(card);
  };

  if (view.show_empty) for (const bucket of grouping.known) add(bucket);
  for (const card of cards) {
    const buckets = grouping.bucketsOf(card);
    if (buckets.length === 0) {
      if (grouping.emptyLabel !== null) {
        add({ key: EMPTY, label: grouping.emptyLabel, order: '' }, card);
      }
      continue;
    }
    // A card listing one answer twice still sits in that group once.
    const seen = new Set<string>();
    for (const bucket of buckets) {
      if (seen.has(bucket.key)) continue;
      seen.add(bucket.key);
      add(bucket, card);
    }
  }

  const compare = grouping.compare ?? byText;
  const sortCards = cardOrder<C>(view.sort_by, input.fields);
  const ordered = [...groups.values()]
    .sort((a, b) => {
      if (a.key === EMPTY) return b.key === EMPTY ? 0 : 1;
      if (b.key === EMPTY) return -1;
      return compare(a.order, b.order) || a.label.localeCompare(b.label);
    })
    .map(({ key, label, sublabel, cards: grouped }) => ({
      key,
      label,
      ...(sublabel ? { sublabel } : {}),
      cards: [...grouped].sort(sortCards),
    }));
  return { ok: true, groups: ordered };
}

function groupingFor<C extends ViewCard>(
  view: ViewSpec,
  field: BoardFieldRow | undefined,
  input: ViewInput<C>
): Grouping<C> {
  const unit: DateUnit = view.date_unit ?? 'month';
  switch (view.group_by) {
    case 'column':
      return columnGrouping(input.columns);
    case 'assignee':
      return assigneeGrouping(input.people, input.viewerEmail);
    case 'due_date':
      return dateGrouping((card) => (card.due_date ? [card.due_date] : []), unit);
    case 'created_at':
      return dateGrouping((card) => [easternDate(new Date(card.created_at))], unit);
    case 'field':
      // groupCards has already refused a missing field.
      return fieldGrouping(field as BoardFieldRow, unit, input.links);
  }
}

// ---------------------------------------------------------------------------
// Built-ins.

function columnGrouping<C extends ViewCard>(columns: BoardColumnRow[]): Grouping<C> {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const bucketOf = (column: BoardColumnRow): Bucket => ({
    key: column.id,
    label: column.label,
    order: String(column.sort_order).padStart(10, '0'),
  });
  return {
    bucketsOf: (card) => {
      const column = byId.get(card.column_id);
      return column ? [bucketOf(column)] : [];
    },
    // An archived column is listed only while it still holds a card.
    known: columns.filter((column) => !column.archived).map(bucketOf),
    emptyLabel: 'No column',
    compare: (a, b) => a.localeCompare(b),
  };
}

function assigneeGrouping<C extends ViewCard>(
  people: PeopleNames | undefined,
  viewerEmail: string | undefined
): Grouping<C> {
  const viewer = viewerEmail?.trim().toLowerCase() ?? '';
  return {
    bucketsOf: (card) =>
      card.assignee_emails.map((email) => {
        const label = personName(email, people);
        // "0" sorts the viewer ahead of everyone's names.
        return { key: email, label, order: email === viewer ? '0' : `1${label.toLowerCase()}` };
      }),
    known: [],
    emptyLabel: 'Unassigned',
  };
}

// ---------------------------------------------------------------------------
// Dates.

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const SHORT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** The group a YYYY-MM-DD date falls in, at this unit. */
export function dateBucket(date: string, unit: DateUnit): { key: string; label: string } {
  switch (unit) {
    case 'day':
      return { key: date, label: DAY_FORMAT.format(new Date(`${date}T00:00:00Z`)) };
    case 'week': {
      const start = sundayStartOf(date);
      return {
        key: start,
        label: `Week of ${SHORT_FORMAT.format(new Date(`${start}T00:00:00Z`))}`,
      };
    }
    case 'month': {
      const start = monthStartOf(date);
      return { key: start, label: formatMonth(start) };
    }
    case 'year':
      return { key: date.slice(0, 4), label: date.slice(0, 4) };
  }
}

function dateGrouping<C extends ViewCard>(
  datesOf: (card: C) => string[],
  unit: DateUnit
): Grouping<C> {
  return {
    bucketsOf: (card) =>
      datesOf(card)
        .filter(isYmd)
        .map((date) => {
          const bucket = dateBucket(date, unit);
          return { ...bucket, order: bucket.key };
        }),
    known: [],
    emptyLabel: 'No date',
  };
}

/** A date answer's dates: one, or the several a form may collect. */
function datesOfAnswer(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((date): date is string => typeof date === 'string' && isYmd(date));
}

// ---------------------------------------------------------------------------
// Fields.

/** Option groups in the field's own order, a since-removed option after them. */
function optionBucket(field: BoardFieldRow, option: string): Bucket {
  const index = field.options.indexOf(option);
  return {
    key: option,
    label: option,
    order: index >= 0 ? `0${String(index).padStart(4, '0')}` : `1${option.toLowerCase()}`,
  };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function fieldGrouping<C extends ViewCard>(
  field: BoardFieldRow,
  unit: DateUnit,
  links: Map<string, LinkSummary> | undefined
): Grouping<C> {
  const answer = (card: C) => card.properties?.[field.key];

  switch (field.kind) {
    case 'date':
      return dateGrouping((card) => datesOfAnswer(answer(card)), unit);

    case 'choice':
      return {
        bucketsOf: (card) => {
          const value = answer(card);
          return typeof value === 'string' && value ? [optionBucket(field, value)] : [];
        },
        known: field.options.map((option) => optionBucket(field, option)),
        emptyLabel: 'None',
      };

    case 'multi_choice':
      return {
        bucketsOf: (card) => {
          const value = answer(card);
          const list = Array.isArray(value) ? value : [];
          return list
            .filter((option): option is string => typeof option === 'string' && option !== '')
            .map((option) => optionBucket(field, option));
        },
        known: field.options.map((option) => optionBucket(field, option)),
        emptyLabel: 'None',
      };

    case 'yes_no': {
      const yes = { key: 'yes', label: 'Yes', order: '0' };
      const no = { key: 'no', label: 'No', order: '1' };
      return {
        bucketsOf: (card) => {
          const value = answer(card);
          return value === true ? [yes] : value === false ? [no] : [];
        },
        known: [yes, no],
        emptyLabel: 'Not answered',
      };
    }

    case 'checklist': {
      const done = { key: 'done', label: 'Done', order: '0' };
      const started = { key: 'started', label: 'In progress', order: '1' };
      const fresh = { key: 'not_started', label: 'Not started', order: '2' };
      return {
        bucketsOf: (card) => {
          // A card that has not touched its list is working the field's default.
          const list = checklistOf(field, answer(card));
          if (formatChecklist(list) === '') return [];
          if (checklistDone(list)) return [done];
          return list.checks.length > 0 ? [started] : [fresh];
        },
        known: [done, started, fresh],
        emptyLabel: 'No items',
      };
    }

    case 'card_link':
      return {
        bucketsOf: (card) =>
          linkIdsOf(answer(card)).map((id) => {
            const summary = links?.get(id);
            const label = summary?.title ?? 'A card you cannot open';
            return {
              key: id,
              label,
              ...(summary ? { sublabel: `${summary.board_name} · ${summary.column_label}` } : {}),
              order: label.toLowerCase(),
            };
          }),
        known: [],
        emptyLabel: 'Not linked',
      };

    case 'files': {
      const some = { key: 'files', label: 'Has files', order: '0' };
      const none = { key: 'no_files', label: 'No files', order: '1' };
      return {
        bucketsOf: (card) => [fileIdsOf(answer(card)).length > 0 ? some : none],
        known: [some, none],
        emptyLabel: null,
      };
    }

    case 'number':
      return {
        bucketsOf: (card) => {
          const value = answer(card);
          return typeof value === 'number' && Number.isFinite(value)
            ? [{ key: String(value), label: String(value), order: String(value) }]
            : [];
        },
        known: [],
        emptyLabel: 'Empty',
        compare: (a, b) => Number(a) - Number(b),
      };

    case 'time':
    case 'time_range':
      return {
        bucketsOf: (card) => {
          const value = answer(card);
          const start = Array.isArray(value) ? value[0] : value;
          if (typeof start !== 'string' || !TIME_RE.test(start)) return [];
          // By the hour it starts in: "6:00 PM" holds 6:00 through 6:59.
          const hour = `${start.slice(0, 2)}:00`;
          return [{ key: hour, label: formatProperty({ kind: 'time' }, hour), order: hour }];
        },
        known: [],
        emptyLabel: 'No time',
      };

    default:
      // text, email, phone: the same words, whatever their case, are one group.
      return {
        bucketsOf: (card) => {
          const value = answer(card);
          if (typeof value !== 'string' || !value.trim()) return [];
          const key = value.trim().toLowerCase();
          return [{ key, label: formatProperty(field, value.trim()), order: key }];
        },
        known: [],
        emptyLabel: 'Empty',
      };
  }
}

// ---------------------------------------------------------------------------
// The order within a group.

function byHand(a: ViewCard, b: ViewCard): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

/** Ascending with the missing ones last, then by hand. */
function nullsLast<T extends string | number>(a: T | null, b: T | null, tie: () => number): number {
  if (a === null) return b === null ? tie() : 1;
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return tie();
}

/** The value a field sort reads off a card: the earliest date, the number, the start time. */
function sortValue(field: BoardFieldRow, value: unknown): string | number | null {
  switch (field.kind) {
    case 'date': {
      const dates = datesOfAnswer(value).sort();
      return dates[0] ?? null;
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    case 'time':
    case 'time_range': {
      const start = Array.isArray(value) ? value[0] : value;
      return typeof start === 'string' && TIME_RE.test(start) ? start : null;
    }
    default:
      return null;
  }
}

function cardOrder<C extends ViewCard>(
  sortBy: string,
  fields: BoardFieldRow[]
): (a: C, b: C) => number {
  switch (sortBy) {
    case 'due_date':
      return (a, b) => nullsLast(a.due_date, b.due_date, () => byHand(a, b));
    case 'title':
      return (a, b) => a.title.localeCompare(b.title) || byHand(a, b);
    case 'created_at':
      // Newest first: the sort for "what came in".
      return (a, b) => b.created_at.localeCompare(a.created_at);
  }
  if (sortBy.startsWith('field:')) {
    const field = fields.find((f) => f.key === sortBy.slice('field:'.length) && !f.archived);
    if (field && SORTABLE_KINDS.includes(field.kind)) {
      return (a, b) =>
        nullsLast(
          sortValue(field, a.properties?.[field.key]),
          sortValue(field, b.properties?.[field.key]),
          () => byHand(a, b)
        );
    }
  }
  return byHand;
}
