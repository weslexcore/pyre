// What an agent suggestion is, as both the server and the review UI read it:
// the kinds of action an agent may propose, the shape of each kind's payload,
// and how to describe one in a line. Pure and client-bundle-safe; the
// server-side checks against live data (does the board exist, has the SOP
// moved on) are each kind's handler in ./kinds.
//
// A payload is what the admin edits before approving, so its shape is the
// same one the editors hold and the agent sends: camelCase, like the admin
// API bodies, so the board parsers can read a card payload directly.
//
// Adding a kind: a value in the migration's check, an entry in
// SUGGESTION_KINDS and PAYLOAD_PARSERS here, a handler in ./kinds, and an
// editor in components/admin/suggestions/editors. The Record types make each
// of those a type error until it exists.

import { emailList } from '@/lib/boards/validate';
import type {
  AgentSuggestionKind,
  AgentSuggestionRow,
  AgentSuggestionSourceType,
  AgentSuggestionStatus,
} from '@/lib/db';
import { isUuid } from '@/lib/http/json';
import { formatQuantity, parseQuantity } from '@/lib/inventory/rules';
import { BODY_MAX, parseAudience, TITLE_MAX } from '@/lib/messages/validate';
import type { SopRole } from '@/lib/sops/levels';
import { type Importance, isImportance, isSeverity, type Severity } from './priority';

export type SuggestionKind = AgentSuggestionKind;
export type SuggestionStatus = AgentSuggestionStatus;
export type SuggestionSourceType = AgentSuggestionSourceType;

export const SUGGESTION_KINDS: readonly SuggestionKind[] = [
  'board_card.create',
  'board_card.comment',
  'sop.edit',
  'shift_assignment.update',
  'inventory.count',
  'inventory.create',
  'message.create',
  'message.edit',
];

/** The kinds that change the inventory: an admin can approve a batch of them together. */
export const INVENTORY_SUGGESTION_KINDS = ['inventory.count', 'inventory.create'] as const;
export type InventorySuggestionKind = (typeof INVENTORY_SUGGESTION_KINDS)[number];

export function isInventorySuggestionKind(value: unknown): value is InventorySuggestionKind {
  return (
    typeof value === 'string' && (INVENTORY_SUGGESTION_KINDS as readonly string[]).includes(value)
  );
}

export const SUGGESTION_SOURCE_TYPES: readonly SuggestionSourceType[] = [
  'shift_note',
  'pyre_agent',
];

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return typeof value === 'string' && (SUGGESTION_KINDS as readonly string[]).includes(value);
}

export function isSuggestionSourceType(value: unknown): value is SuggestionSourceType {
  return (
    typeof value === 'string' && (SUGGESTION_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export const KIND_LABELS: Record<SuggestionKind, string> = {
  'board_card.create': 'New task',
  'board_card.comment': 'Comment on task',
  'sop.edit': 'SOP edit',
  'shift_assignment.update': 'Hours change',
  'inventory.count': 'Inventory count',
  'inventory.create': 'New inventory item',
  'message.create': 'New message',
  'message.edit': 'Message edit',
};

export const SOURCE_LABELS: Record<SuggestionSourceType, string> = {
  shift_note: 'Shift note',
  pyre_agent: 'Pyre Agent',
};

/** At most this many suggestions from one run, besides inventory changes. */
export const MAX_SUGGESTIONS_PER_RUN = 8;
/**
 * At most this many inventory changes from one run. Kept apart from the cap
 * above: an inventory-count note lists every supply on the shelf, often
 * twenty or more, and each is one row of a single batch to approve.
 */
export const MAX_INVENTORY_PER_RUN = 50;

/** Whether a list stays within both caps; the error names the one it breaks. */
export function checkRunSize(kinds: readonly unknown[]): string | null {
  const inventory = kinds.filter(isInventorySuggestionKind).length;
  if (inventory > MAX_INVENTORY_PER_RUN) {
    return `At most ${MAX_INVENTORY_PER_RUN} inventory changes per run`;
  }
  if (kinds.length - inventory > MAX_SUGGESTIONS_PER_RUN) {
    return `At most ${MAX_SUGGESTIONS_PER_RUN} suggestions per run besides inventory changes`;
  }
  return null;
}
export const MAX_RATIONALE = 2000;
export const MAX_DECISION_NOTE = 1000;

// Mirrors of the limits the apply paths enforce (BOARD_LIMITS, the SOP
// route), repeated here only so the editors can say so before the server does.
export const SUGGESTION_LIMITS = {
  title: 200,
  notes: 10_000,
  comment: 4000,
  sopTitle: 200,
  sopContent: 100_000,
  changeNote: 300,
  hunks: 20,
  messageTitle: TITLE_MAX,
  messageBody: BODY_MAX,
} as const;

/** A new card on a board. */
export interface CardCreatePayload {
  /** Board slug. */
  board: string;
  /** A column key on that board; null for its first open column. */
  columnKey: string | null;
  title: string;
  notesMd: string;
  /** YYYY-MM-DD, or null. */
  dueDate: string | null;
  /**
   * Who the card is put on. Filled with the board's default assignees when
   * the suggestion comes in; empty still takes them when the card is made.
   */
  assigneeEmails: string[];
  /** How bad it is if nobody acts; with importance, picks the due date (./priority). */
  severity: Severity | null;
  /** How much the work matters to the business. */
  importance: Importance | null;
  /** Answers to the board's own fields, keyed by field key. */
  properties: Record<string, unknown>;
}

/** A comment on a card that already covers the work. */
export interface CardCommentPayload {
  cardId: string;
  note: string;
}

/** One exact find-and-replace in an SOP, as the agent proposed it. */
export interface SopHunk {
  find: string;
  replace: string;
}

/** A new version of an SOP. */
export interface SopEditPayload {
  sopId: string;
  slug: string;
  /** The version the edit was made against; approving it on a newer one is a conflict. */
  baseVersion: number;
  title: string;
  /** The whole proposed document — what the admin edits and what gets saved. */
  contentMd: string;
  changeNote: string;
  /**
   * The agent's hunks, kept so the edit can be replayed on a newer version
   * when the SOP changes before anyone approves (./sop-edit rebaseSopEdit).
   */
  edits: SopHunk[];
}

/**
 * New hours for one person's assignment on a shift — what they actually
 * worked, which is what the timesheet pays. The agent sends the assignment
 * and the time(s) the note gives; the rest is filled from the live
 * assignment when it is checked, for the admin reading it.
 */
export interface ShiftTimesPayload {
  assignmentId: string;
  /** HH:MM. */
  startsAt: string;
  /** HH:MM. */
  endsAt: string;
  staffName: string;
  shiftId: string;
  shiftLabel: string;
  /** YYYY-MM-DD. */
  shiftDate: string;
  /** The assignment's hours when this was last checked: what it changes from. */
  scheduledStartsAt: string;
  scheduledEndsAt: string;
}

/**
 * A new stock number for one inventory item, read out of a note ("three
 * rolls of trash bags left"). The agent sends the item and the number; the
 * rest is filled when it is checked (the item as it stands, for the admin
 * reading it) and at intake (who wrote the note, and when — the count is
 * credited to them, not to the approving admin).
 */
export interface InventoryCountPayload {
  itemId: string;
  /**
   * Stock on hand once this is applied. For a set ("2 left") it is the note's
   * number; for a change it is the stock on record plus `change`, resolved
   * again against the item as it stands each time the payload is checked.
   */
  inStock: number;
  /**
   * How much the note says the stock moved, signed: "used 52" is -52, "got
   * 10 in" is +10. Null for a set, where the note gives the number on hand.
   * Approving applies the change to the stock at approval time, so a count
   * approved in between is not overwritten. An admin who types a number into
   * the box turns it into a set.
   */
  change: number | null;
  itemName: string;
  /** The item's stock when this was last checked: what it changes from. */
  previousInStock: number | null;
  reorderAt: number | null;
  lastCountedAt: string | null;
  lastCountedBy: string | null;
  /** The note's author (email) and the note's time; null in a dry run. */
  countedBy: string | null;
  countedAt: string | null;
}

/**
 * A supply the inventory does not track yet, read out of a note ("we keep a
 * box of earplugs at the desk now, about 40 left"): the item to add, with
 * whatever the note gives. Like a count, a starting number is credited to
 * the note's author at the note's time (filled at intake); the item itself
 * is added by the approving admin.
 */
export interface InventoryCreatePayload {
  name: string;
  category: string | null;
  /** Where it is kept. */
  location: string | null;
  vendor: string | null;
  /** Stock on hand, when the note gives it; null leaves it uncounted (0). */
  inStock: number | null;
  /** Flag for re-order at or below this; null = never. */
  reorderAt: number | null;
  /** Count at least every this many studio days; null = no schedule. */
  countEveryDays: number | null;
  /** The note's author (email) and the note's time; null in a dry run. */
  countedBy: string | null;
  countedAt: string | null;
}

/**
 * A new admin message. Approving saves it as a draft by the approving admin,
 * who sends it from the composer (where the audience is told and emailed),
 * so approving never reaches the team on its own.
 */
export interface MessageCreatePayload {
  title: string;
  bodyMd: string;
  audienceRoles: SopRole[];
  audienceEmails: string[];
  requiresAck: boolean;
  pinned: boolean;
}

/**
 * New wording for an existing admin message: its title and body. The
 * message as it stood when this was checked rides along, so the editor can
 * show the change and approving can refuse one that someone has since
 * re-saved (baseUpdatedAt).
 */
export interface MessageEditPayload {
  messageId: string;
  title: string;
  bodyMd: string;
  /** The message's updated_at when the edit was made: approving on a newer save is a conflict. */
  baseUpdatedAt: string;
  previousTitle: string;
  previousBodyMd: string;
  /** Whether it has gone out (false: a draft). */
  sent: boolean;
}

export interface PayloadByKind {
  'board_card.create': CardCreatePayload;
  'board_card.comment': CardCommentPayload;
  'sop.edit': SopEditPayload;
  'shift_assignment.update': ShiftTimesPayload;
  'inventory.count': InventoryCountPayload;
  'inventory.create': InventoryCreatePayload;
  'message.create': MessageCreatePayload;
  'message.edit': MessageEditPayload;
}

export type SuggestionPayload = PayloadByKind[SuggestionKind];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export { isUuid };

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

function parseCardCreatePayload(raw: unknown): ParseResult<CardCreatePayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  const board = str(o.board);
  if (!board) return fail('board is required (a board slug)');
  const title = str(o.title);
  if (!title || title.length > SUGGESTION_LIMITS.title) {
    return fail(`title must be 1–${SUGGESTION_LIMITS.title} characters`);
  }
  const notesMd = typeof o.notesMd === 'string' ? o.notesMd.trim() : '';
  if (notesMd.length > SUGGESTION_LIMITS.notes) {
    return fail(`notesMd must be ${SUGGESTION_LIMITS.notes} characters or fewer`);
  }
  const columnKey = str(o.columnKey) || null;
  let dueDate: string | null = null;
  if (o.dueDate !== undefined && o.dueDate !== null && o.dueDate !== '') {
    if (typeof o.dueDate !== 'string' || !YMD_RE.test(o.dueDate)) {
      return fail('dueDate must be a YYYY-MM-DD date');
    }
    dueDate = o.dueDate;
  }
  const assignees = emailList(o.assigneeEmails ?? []);
  if (!assignees.ok) return fail('assigneeEmails must be a list of email addresses');
  const severity = o.severity ?? null;
  if (severity !== null && !isSeverity(severity)) {
    return fail('severity must be critical, high, medium or low');
  }
  const importance = o.importance ?? null;
  if (importance !== null && !isImportance(importance)) {
    return fail('importance must be high, medium or low');
  }
  const properties = asObject(o.properties ?? {});
  if (!properties) return fail('properties must be an object keyed by field key');
  return {
    ok: true,
    value: {
      board,
      columnKey,
      title,
      notesMd,
      dueDate,
      assigneeEmails: assignees.value ?? [],
      severity,
      importance,
      properties,
    },
  };
}

function parseCardCommentPayload(raw: unknown): ParseResult<CardCommentPayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  if (!isUuid(o.cardId)) return fail('cardId must be the UUID of an existing card');
  const note = str(o.note);
  if (!note || note.length > SUGGESTION_LIMITS.comment) {
    return fail(`note must be 1–${SUGGESTION_LIMITS.comment} characters`);
  }
  return { ok: true, value: { cardId: o.cardId, note } };
}

function parseHunks(raw: unknown): ParseResult<SopHunk[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('edits must be a list of { find, replace }');
  if (raw.length > SUGGESTION_LIMITS.hunks) {
    return fail(`at most ${SUGGESTION_LIMITS.hunks} edits per SOP`);
  }
  const hunks: SopHunk[] = [];
  for (const [i, entry] of raw.entries()) {
    const o = asObject(entry);
    if (!o || typeof o.find !== 'string' || typeof o.replace !== 'string') {
      return fail(`edits[${i}] must be { find, replace } text`);
    }
    if (!o.find) return fail(`edits[${i}].find must not be empty`);
    hunks.push({ find: o.find, replace: o.replace });
  }
  return { ok: true, value: hunks };
}

function parseSopEditPayload(raw: unknown): ParseResult<SopEditPayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  if (!isUuid(o.sopId)) return fail('sopId must be the UUID of an SOP');
  const slug = str(o.slug);
  if (!slug) return fail('slug is required');
  if (typeof o.baseVersion !== 'number' || !Number.isInteger(o.baseVersion) || o.baseVersion < 1) {
    return fail('baseVersion must be the SOP version the edit was made against');
  }
  const title = str(o.title);
  if (!title || title.length > SUGGESTION_LIMITS.sopTitle) {
    return fail(`title must be 1–${SUGGESTION_LIMITS.sopTitle} characters`);
  }
  if (typeof o.contentMd !== 'string' || o.contentMd.length > SUGGESTION_LIMITS.sopContent) {
    return fail(`contentMd must be text of at most ${SUGGESTION_LIMITS.sopContent} characters`);
  }
  const changeNote = str(o.changeNote).slice(0, SUGGESTION_LIMITS.changeNote);
  const edits = parseHunks(o.edits);
  if (!edits.ok) return edits;
  return {
    ok: true,
    value: {
      sopId: o.sopId,
      slug,
      baseVersion: o.baseVersion,
      title,
      contentMd: o.contentMd,
      changeNote,
      edits: edits.value,
    },
  };
}

function parseShiftTimesPayload(raw: unknown): ParseResult<ShiftTimesPayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  if (!isUuid(o.assignmentId)) {
    return fail('assignmentId must be the UUID of an assignment from find_shift_assignments');
  }
  // Either time may be left out ("stayed until 8:30" only moves the end):
  // checking the payload fills it from the assignment as it stands.
  const time = (key: 'startsAt' | 'endsAt'): string | null => {
    const value = o[key];
    if (value === undefined || value === null || value === '') return '';
    return typeof value === 'string' && HM_RE.test(value) ? value.slice(0, 5) : null;
  };
  const startsAt = time('startsAt');
  const endsAt = time('endsAt');
  if (startsAt === null) return fail('startsAt must be HH:MM (24-hour)');
  if (endsAt === null) return fail('endsAt must be HH:MM (24-hour)');
  if (!startsAt && !endsAt) return fail('give startsAt, endsAt, or both');
  return {
    ok: true,
    value: {
      assignmentId: o.assignmentId,
      startsAt,
      endsAt,
      staffName: str(o.staffName),
      shiftId: str(o.shiftId),
      shiftLabel: str(o.shiftLabel),
      shiftDate: str(o.shiftDate),
      scheduledStartsAt: str(o.scheduledStartsAt),
      scheduledEndsAt: str(o.scheduledEndsAt),
    },
  };
}

/** A signed stock change ("used 52" is -52): nonzero, within the quantity limit. */
export function parseStockChange(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100000) return null;
  return Math.round(n * 100) / 100;
}

/**
 * The stock a change leaves on `base` (the stock on record), or null when
 * it would go below zero — the record is wrong, and a person should count.
 */
export function stockAfterChange(base: number, change: number): number | null {
  const next = Math.round((base + change) * 100) / 100;
  return next < 0 ? null : next;
}

function parseInventoryCountPayload(raw: unknown): ParseResult<InventoryCountPayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  if (!isUuid(o.itemId)) {
    return fail('itemId must be the UUID of an inventory item from find_inventory_items');
  }
  const quantity = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') return null;
    return parseQuantity(value);
  };
  const hasChange = o.change !== undefined && o.change !== null && o.change !== '';
  const change = hasChange ? parseStockChange(o.change) : null;
  if (hasChange && change === null) {
    return fail('change must be a number from -100000 to 100000 other than 0');
  }
  const previousInStock = quantity(o.previousInStock);
  // A change with no total yet (the agent sends only the change) is
  // resolved here when the stock on record rides along, and by the
  // handler's validate() against the item otherwise.
  const inStock =
    o.inStock === undefined && change !== null
      ? Math.max(0, (previousInStock ?? 0) + change)
      : parseQuantity(o.inStock);
  if (inStock === null) return fail('inStock must be a number from 0 to 100000');
  const stamp = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value))
      ? value.trim()
      : null;
  const email = (value: unknown): string | null => {
    const s = str(value).toLowerCase();
    return s.includes('@') ? s : null;
  };
  return {
    ok: true,
    value: {
      itemId: o.itemId,
      inStock,
      change,
      itemName: str(o.itemName),
      previousInStock,
      reorderAt: quantity(o.reorderAt),
      lastCountedAt: stamp(o.lastCountedAt),
      lastCountedBy: email(o.lastCountedBy),
      countedBy: email(o.countedBy),
      countedAt: stamp(o.countedAt),
    },
  };
}

/** Limits the inventory list enforces (lib/inventory/rules), for the editors and the agent. */
export const INVENTORY_ITEM_LIMITS = {
  name: 120,
  category: 60,
  location: 120,
  vendor: 120,
} as const;

function optionalQuantity(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return parseQuantity(value) ?? undefined;
}

function optionalStamp(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value))
    ? value.trim()
    : null;
}

function optionalEmail(value: unknown): string | null {
  const s = str(value).toLowerCase();
  return s.includes('@') ? s : null;
}

function parseInventoryCreatePayload(raw: unknown): ParseResult<InventoryCreatePayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  const name = str(o.name);
  if (!name || name.length > INVENTORY_ITEM_LIMITS.name) {
    return fail(`name must be 1–${INVENTORY_ITEM_LIMITS.name} characters`);
  }
  const text = (key: 'category' | 'location' | 'vendor'): string | null | undefined => {
    const value = o[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return undefined;
    const s = value.trim();
    return s.length > INVENTORY_ITEM_LIMITS[key] ? undefined : s || null;
  };
  const category = text('category');
  if (category === undefined) {
    return fail(`category must be text of at most ${INVENTORY_ITEM_LIMITS.category} characters`);
  }
  const location = text('location');
  if (location === undefined) {
    return fail(`location must be text of at most ${INVENTORY_ITEM_LIMITS.location} characters`);
  }
  const vendor = text('vendor');
  if (vendor === undefined) {
    return fail(`vendor must be text of at most ${INVENTORY_ITEM_LIMITS.vendor} characters`);
  }
  const inStock = optionalQuantity(o.inStock);
  if (inStock === undefined) return fail('inStock must be a number from 0 to 100000');
  const reorderAt = optionalQuantity(o.reorderAt);
  if (reorderAt === undefined) return fail('reorderAt must be a number from 0 to 100000');
  let countEveryDays: number | null = null;
  if (o.countEveryDays !== undefined && o.countEveryDays !== null && o.countEveryDays !== '') {
    const days = Number(o.countEveryDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return fail('countEveryDays must be a whole number of days from 1 to 365');
    }
    countEveryDays = days;
  }
  return {
    ok: true,
    value: {
      name,
      category,
      location,
      vendor,
      inStock,
      reorderAt,
      countEveryDays,
      countedBy: optionalEmail(o.countedBy),
      countedAt: optionalStamp(o.countedAt),
    },
  };
}

function messageText(
  o: Record<string, unknown>
): { ok: true; title: string; bodyMd: string } | { ok: false; error: string } {
  const title = str(o.title);
  if (!title || title.length > TITLE_MAX) {
    return { ok: false, error: `title must be 1–${TITLE_MAX} characters` };
  }
  const bodyMd = typeof o.bodyMd === 'string' ? o.bodyMd.trim() : '';
  if (!bodyMd || bodyMd.length > BODY_MAX) {
    return { ok: false, error: `bodyMd must be 1–${BODY_MAX} characters` };
  }
  return { ok: true, title, bodyMd };
}

function parseMessageCreatePayload(raw: unknown): ParseResult<MessageCreatePayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  const text = messageText(o);
  if (!text.ok) return fail(text.error);
  const audience = parseAudience(o.audienceRoles ?? [], o.audienceEmails ?? []);
  if (!audience.ok) return fail(audience.error);
  return {
    ok: true,
    value: {
      title: text.title,
      bodyMd: text.bodyMd,
      audienceRoles: audience.audience.roles,
      audienceEmails: audience.audience.emails,
      requiresAck: o.requiresAck === true,
      pinned: o.pinned === true,
    },
  };
}

function parseMessageEditPayload(raw: unknown): ParseResult<MessageEditPayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  if (!isUuid(o.messageId)) return fail('messageId must be the id of a message from get_messages');
  const text = messageText(o);
  if (!text.ok) return fail(text.error);
  return {
    ok: true,
    value: {
      messageId: o.messageId,
      title: text.title,
      bodyMd: text.bodyMd,
      baseUpdatedAt: str(o.baseUpdatedAt),
      previousTitle: typeof o.previousTitle === 'string' ? o.previousTitle : '',
      previousBodyMd: typeof o.previousBodyMd === 'string' ? o.previousBodyMd : '',
      sent: o.sent !== false,
    },
  };
}

/** Shape checks per kind; the live-data checks are each kind's validate() in ./kinds. */
export const PAYLOAD_PARSERS: {
  [K in SuggestionKind]: (raw: unknown) => ParseResult<PayloadByKind[K]>;
} = {
  'board_card.create': parseCardCreatePayload,
  'board_card.comment': parseCardCommentPayload,
  'sop.edit': parseSopEditPayload,
  'shift_assignment.update': parseShiftTimesPayload,
  'inventory.count': parseInventoryCountPayload,
  'inventory.create': parseInventoryCreatePayload,
  'message.create': parseMessageCreatePayload,
  'message.edit': parseMessageEditPayload,
};

export function parsePayload<K extends SuggestionKind>(
  kind: K,
  raw: unknown
): ParseResult<PayloadByKind[K]> {
  return PAYLOAD_PARSERS[kind](raw);
}

/** The payload an approval would apply now: the admin's edit, else the original. */
export function currentPayload(
  row: Pick<AgentSuggestionRow, 'payload' | 'edited_payload'>
): Record<string, unknown> {
  return row.edited_payload ?? row.payload;
}

/** One line for the inbox, the notification, and the note's history. */
export function describeSuggestion(kind: SuggestionKind, payload: unknown): string {
  const o = asObject(payload) ?? {};
  switch (kind) {
    case 'board_card.create':
      return `New task: ${str(o.title) || 'untitled'}`;
    case 'board_card.comment':
      return `Comment on a task: ${str(o.note).slice(0, 80)}`;
    case 'sop.edit':
      return `Edit SOP: ${str(o.title) || str(o.slug) || 'untitled'}`;
    case 'shift_assignment.update':
      return `Hours change: ${str(o.staffName) || 'someone'} ${str(o.shiftDate)} ${str(o.startsAt)}–${str(o.endsAt)}`.replace(
        /\s+/g,
        ' '
      );
    case 'inventory.count': {
      const count = parseQuantity(o.inStock);
      const change = parseStockChange(o.change);
      const moved =
        change === null ? '' : ` (${change > 0 ? '+' : '−'}${formatQuantity(Math.abs(change))})`;
      return `Inventory count: ${str(o.itemName) || 'an item'}, ${count === null ? '?' : formatQuantity(count)} in stock${moved}`;
    }
    case 'inventory.create': {
      const count = o.inStock === null || o.inStock === undefined ? null : parseQuantity(o.inStock);
      return `New inventory item: ${str(o.name) || 'unnamed'}${count === null ? '' : `, ${formatQuantity(count)} in stock`}`;
    }
    case 'message.create':
      return `New message: ${str(o.title) || 'untitled'}`;
    case 'message.edit':
      return `Edit message: ${str(o.previousTitle) || str(o.title) || 'untitled'}`;
  }
}

/** Where the review UI and notifications link for a source record. */
export function sourceHref(type: SuggestionSourceType, id: string): string {
  switch (type) {
    case 'shift_note':
      return `/admin/shift-notes#note-${id}`;
    case 'pyre_agent':
      return `/admin/ask?c=${encodeURIComponent(id)}`;
  }
}

/** A message's thread (or, for a draft, its composer). */
export function messageHref(id: string): string {
  return `/admin/messages/${id}`;
}

/** A card's own link: its board, opened on the card. */
export function cardHref(boardSlug: string, cardId: string): string {
  return `/admin/boards/${boardSlug}#card-${cardId}`;
}

/** A decided suggestion's result, resolved server-side for the review UI. */
export interface SuggestionResultLink {
  label: string;
  href: string | null;
}

/** An active inventory item, as the count editor's item picker offers it. */
export interface InventoryOption {
  id: string;
  name: string;
  category: string | null;
  location: string | null;
  in_stock: number;
  reorder_at: number | null;
  last_counted_at: string | null;
  last_counted_by: string | null;
}

/** A suggestion as the review UI reads it. */
export type SuggestionView = AgentSuggestionRow & {
  /** The source's text has changed since the agent read it. */
  sourceChanged: boolean;
};

/** A run as the review UI reads it: stale open runs read as failed. */
export interface RunView {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  trigger: 'auto' | 'manual';
  count: number;
  error: string | null;
  createdAt: string;
}

/** A source record as the inbox shows it; null when it has been deleted. */
export interface SourceSummary {
  label: string;
  href: string;
  excerpt: string;
}

/** Links the review UI needs per suggestion: what approving made, and what it acts on. */
export interface SuggestionLinks {
  results: Record<string, SuggestionResultLink>;
  targets: Record<string, SuggestionResultLink>;
}
