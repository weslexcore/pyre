// Client-safe vocabulary for boards: the column and field kinds, the grant
// key that opens exactly one board, and the limits the forms and the routes
// agree on. Imports nothing but types — the islands and adminTools.ts both
// pull from here, so it has to stay bundle-safe and cycle-free.

/** The tool href a board grant is measured against. */
export const BOARDS_HREF = '/admin/boards';

/**
 * The cross-board month view: every dated thing on every board, plus the
 * goals' target dates. Lives under /admin/boards so the tool's grant covers
 * it, and `calendar` is reserved so no board can shadow it.
 */
export const BOARDS_CALENDAR_HREF = '/admin/boards/calendar';

/**
 * The seeded board the founders' tasks live on. Its cards are the ones a goal
 * rolls up and All Tasks lists; every other board is a pipeline.
 */
export const GOALS_BOARD_SLUG = 'goals';

export const COLUMN_KINDS = ['open', 'done', 'dropped'] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  open: 'In flight',
  done: 'Finished',
  dropped: 'Dropped',
};

export const COLUMN_KIND_HINTS: Record<ColumnKind, string> = {
  open: 'Still being worked on.',
  done: 'Finished well — cards landing here are stamped complete.',
  dropped: 'Finished badly: a lost lead, an abandoned task.',
};

export function isColumnKind(value: unknown): value is ColumnKind {
  return typeof value === 'string' && (COLUMN_KINDS as readonly string[]).includes(value);
}

/** A column whose cards count as finished, done well or not. */
export function isFinishedKind(kind: ColumnKind): boolean {
  return kind === 'done' || kind === 'dropped';
}

export const FIELD_KINDS = [
  'text',
  'long_text',
  'email',
  'phone',
  'number',
  'yes_no',
  'choice',
  'multi_choice',
  'date',
  'datetime',
  'time',
  'time_range',
  'files',
  'card_link',
  'checklist',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  yes_no: 'Yes / no',
  choice: 'Pick one',
  multi_choice: 'Pick any',
  date: 'Date',
  datetime: 'Date & time',
  time: 'Time',
  time_range: 'Time range',
  files: 'Files',
  card_link: 'Linked cards',
  checklist: 'Checklist',
};

export function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === 'string' && (FIELD_KINDS as readonly string[]).includes(value);
}

/**
 * How long an answer of this kind may be. A long text is a paragraph or
 * several — the reason somebody asked for it — while every other typed
 * answer is a line, and a line that runs to 500 characters is already
 * somebody using the wrong field.
 */
export function answerLimit(kind: FieldKind): number {
  return kind === 'long_text' ? BOARD_LIMITS.longAnswer : BOARD_LIMITS.textAnswer;
}

/** Kinds whose answers come from `options`. */
export function kindHasOptions(kind: FieldKind): boolean {
  return kind === 'choice' || kind === 'multi_choice';
}

/**
 * Kinds whose answer is one or more days: a `date`, or a `datetime` that
 * names the moment on the day as well. Both can take several answers, sit on
 * the calendar, and group a view by day, week, month or year.
 */
export function kindIsDated(kind: FieldKind): boolean {
  return kind === 'date' || kind === 'datetime';
}

/**
 * Kinds that may hold one answer or several: days, moments, or times. A
 * form question can ask for just one (`multiple`); the card drawer takes
 * as many as are given.
 */
export function kindTakesSeveral(kind: FieldKind): boolean {
  return kindIsDated(kind) || kind === 'time';
}

/**
 * Kinds that can time a date field on the calendar. A `time` gives the entry
 * a moment, a `time_range` gives it a window; anything else leaves it all-day.
 */
export function kindIsTime(kind: FieldKind): boolean {
  return kind === 'time' || kind === 'time_range';
}

/**
 * The kind whose answer is a list of attachment ids rather than something
 * typed. Its bytes live in board_attachments (lib/boards/files.ts has the
 * rules), and every route that writes a card has to settle them.
 */
export function kindIsFiles(kind: FieldKind): boolean {
  return kind === 'files';
}

/**
 * The kind whose answer is cards on another board (or this one). The links
 * live in board_card_links, not in properties (lib/boards/links.ts has the
 * rules), and every route that writes a card has to settle them — or, where
 * links make no sense (a public form, intake), drop them.
 */
export function kindIsCardLink(kind: FieldKind): boolean {
  return kind === 'card_link';
}

/**
 * The kind whose answer is a list worked through on the card: items
 * completed or skipped, each stamped with who and when by the route that
 * writes it (lib/boards/checklist.ts). Staff work, so it stays off public
 * forms, intake and agent suggestions, like a link.
 */
export function kindIsChecklist(kind: FieldKind): boolean {
  return kind === 'checklist';
}

/**
 * Kinds a card's answer can't simply be typed into: they're settled against
 * a side table by the routes that write cards, and they never appear on a
 * public form.
 */
export function kindIsSettled(kind: FieldKind): boolean {
  return kindIsFiles(kind) || kindIsCardLink(kind);
}

// A staff row's `pages` array holds tool hrefs and capability keys; this is a
// third shape. 'board:rentals' opens /admin/boards and the rentals board and
// nothing else — which is the whole point: the community manager working the
// lead pipeline never sees the founders' goals. A plain '/admin/boards' grant
// still means every board.
export const BOARD_GRANT_PREFIX = 'board:';

export function boardGrantKey(slug: string): string {
  return `${BOARD_GRANT_PREFIX}${slug}`;
}

export function isBoardGrantKey(key: string): boolean {
  return key.startsWith(BOARD_GRANT_PREFIX) && key.length > BOARD_GRANT_PREFIX.length;
}

/** The slug a grant key names, or '' when it isn't one. */
export function boardSlugFromGrant(key: string): string {
  return isBoardGrantKey(key) ? key.slice(BOARD_GRANT_PREFIX.length) : '';
}

/** Matches the boards.slug check constraint. */
export const SLUG_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** Matches the board_columns.key / board_fields.key check constraint. */
export const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

export function isBoardSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_RE.test(value);
}

/**
 * "Rental & group leads" -> "rental-group-leads". A suggestion for the new
 * board form, not a validator — the caller can type over it, and the route
 * checks the result against SLUG_RE either way. Returns '' when there is
 * nothing usable to slugify (a name of only punctuation, or one starting
 * with a digit, which the constraint forbids).
 */
export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return SLUG_RE.test(slug) ? slug : '';
}

/**
 * Limits shared by the forms (maxLength) and the routes (validation), mirroring
 * the check constraints in the migration.
 */
export const BOARD_LIMITS = {
  name: 60,
  slug: 40,
  description: 500,
  cardNoun: 20,
  columnLabel: 40,
  columnKey: 40,
  fieldLabel: 60,
  fieldHint: 200,
  option: 60,
  optionsPerField: 40,
  /** A card drawer is a form, not a database; past this it needs a rethink. */
  fieldsPerBoard: 30,
  sectionName: 60,
  /** Sanity bounds far above any plausible index. */
  sectionsPerIndex: 100,
  boardsPerSection: 200,
  title: 300,
  notes: 20000,
  waitingOn: 120,
  area: 40,
  /** People on one card, or a board's defaults. Mirrors the columns' checks. */
  assignees: 20,
  externalRef: 200,
  comment: 4000,
  textAnswer: 500,
  /** A long text answer: paragraphs, but still an answer and not a document. */
  longAnswer: 4000,
  /** A files field holds a handful of documents, not a folder. */
  filesPerField: 10,
  /** A card_link field lists a handful of cards; past this it's a board of its own. */
  linksPerField: 50,
  /** A checklist's markdown, the default or a card's own copy. */
  checklist: 10000,
  /** How many cards the link picker offers at once; type to narrow. */
  linkOptions: 50,
  /** A board is a page, not a database: past this it needs paging. */
  cardsPerBoard: 1000,
  viewName: 40,
  /** Saved views on one board; past this the switcher stops being a row. */
  viewsPerBoard: 20,
} as const;

// ---------------------------------------------------------------------------
// Saved views: a board's cards grouped by something other than their column.
// The grouping itself is lib/boards/views.ts.

/** What a view groups by: a built-in, or one of the board's fields. */
export const VIEW_GROUP_BYS = ['column', 'assignee', 'due_date', 'created_at', 'field'] as const;
export type ViewGroupBy = (typeof VIEW_GROUP_BYS)[number];

export function isViewGroupBy(value: unknown): value is ViewGroupBy {
  return typeof value === 'string' && (VIEW_GROUP_BYS as readonly string[]).includes(value);
}

/** How a date grouping buckets its cards. */
export const DATE_UNITS = ['day', 'week', 'month', 'year'] as const;
export type DateUnit = (typeof DATE_UNITS)[number];

export const DATE_UNIT_LABELS: Record<DateUnit, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};

export function isDateUnit(value: unknown): value is DateUnit {
  return typeof value === 'string' && (DATE_UNITS as readonly string[]).includes(value);
}

export const VIEW_LAYOUTS = ['sections', 'lanes'] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const VIEW_LAYOUT_LABELS: Record<ViewLayout, string> = {
  sections: 'Sections, stacked',
  lanes: 'Lanes, side by side',
};

export function isViewLayout(value: unknown): value is ViewLayout {
  return typeof value === 'string' && (VIEW_LAYOUTS as readonly string[]).includes(value);
}

/** The order within a group, besides `field:<key>` for a date, number, or time field. */
export const VIEW_SORTS = ['manual', 'due_date', 'title', 'created_at'] as const;
export type ViewSort = (typeof VIEW_SORTS)[number] | `field:${string}`;

/** Every field kind a view can group by. Long text is paragraphs, not a value to share. */
export const GROUPABLE_KINDS: readonly FieldKind[] = [
  'text',
  'email',
  'phone',
  'number',
  'yes_no',
  'choice',
  'multi_choice',
  'date',
  'datetime',
  'time',
  'time_range',
  'files',
  'card_link',
  'checklist',
];

/** The kinds a view can sort a group's cards by. */
export const SORTABLE_KINDS: readonly FieldKind[] = [
  'date',
  'datetime',
  'number',
  'time',
  'time_range',
];
