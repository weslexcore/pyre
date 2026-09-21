// Client-safe vocabulary for boards: the column and field kinds, the grant
// key that opens exactly one board, and the limits the forms and the routes
// agree on. Imports nothing but types — the islands and adminTools.ts both
// pull from here, so it has to stay bundle-safe and cycle-free.

/** The tool href a board grant is measured against. */
export const BOARDS_HREF = '/admin/boards';

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

export const FIELD_KINDS = ['text', 'number', 'yes_no', 'choice', 'multi_choice', 'date'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Short text',
  number: 'Number',
  yes_no: 'Yes / no',
  choice: 'Pick one',
  multi_choice: 'Pick any',
  date: 'Date',
};

export function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === 'string' && (FIELD_KINDS as readonly string[]).includes(value);
}

/** Kinds whose answers come from `options`. */
export function kindHasOptions(kind: FieldKind): boolean {
  return kind === 'choice' || kind === 'multi_choice';
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
  title: 300,
  notes: 20000,
  waitingOn: 120,
  area: 40,
  externalRef: 200,
  comment: 4000,
  textAnswer: 500,
  /** A board is a page, not a database: past this it needs paging. */
  cardsPerBoard: 1000,
} as const;
