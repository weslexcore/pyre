// Content half of the global search (cmd+K): the SOP documents, the matched
// lines inside them, the shift notes containing a term, and the cards on the
// boards whose title or notes contain it. Pages and boards match on the
// client from the lists it already holds. Anyone with dashboard access may
// call this; what comes back is filtered the way each tool filters its own
// reads — SOPs by the caller's page grant plus per-document access
// (lib/sops/levels), shift notes by the page grant plus the "admins read
// everything, everyone else their own" rule (lib/shift-notes/access), cards
// by the boards the caller may open (lib/boards/access — a single-board
// grant searches that board alone), inventory items by the /admin/inventory
// page grant. A snippet can therefore never show text from something the
// caller could not open on its own page.
//
//   GET ?q=<term> → { q, sops, notes, tasks, inventory }

import type { APIRoute } from 'astro';
import { canViewPage, type PageAccess, SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import type {
  InventoryHit,
  NoteHit,
  SearchResponse,
  SopHit,
  TaskHit,
} from '@/lib/admin/globalSearch';
import { requireStaff } from '@/lib/auth/admin';
import { canViewBoardsTool, visibleBoards } from '@/lib/boards/access';
import { loadAllColumns, loadBoards } from '@/lib/boards/store';
import { isFinishedKind } from '@/lib/boards/types';
import { type BoardCardRow, getDb, type ShiftNoteRow, type SopRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { json } from '@/lib/http/route';
import { searchInventory } from '@/lib/inventory/search';
import {
  INVENTORY_HREF,
  type InventoryAreaRow,
  type InventoryCategoryRow,
  type InventoryItemRow,
  type InventorySpotRow,
  type InventoryStockRow,
} from '@/lib/inventory/types';
import { canSeeNote } from '@/lib/shift-notes/access';
import { canViewSop, type SopViewer } from '@/lib/sops/levels';
import { personName } from '@/lib/sops/names';
import { type CategoryRank, sortSops } from '@/lib/sops/order';
import { getPeopleNames } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';
import {
  countMatches,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  matchesTerm,
  queryLength,
  searchEntries,
} from '@/lib/sops/search';

// The palette shows a handful of each; anything past this is better found on
// the tool's own page, which has the full list and its own filters.
const MAX_SOPS = 12;
const ENTRIES_PER_SOP = 3;
const MAX_NOTES = 8;
// How many notes to scan, newest first — the same window the log page shows.
// The matching happens here rather than in SQL so it is the one matcher the
// palette, the log's filter, and the highlights all share (spaces and hyphens
// ignored: "breakdown" finds "break down").
const NOTE_SCAN_LIMIT = 500;
const MAX_TASKS = 10;
// How many cards to scan across the caller's boards, open ones first and
// the most recently touched of those at the top, so a live task always
// outranks a finished one and the cap only ever trims the oldest done pile.
const CARD_SCAN_LIMIT = 1500;
const MAX_INVENTORY = 8;

type Db = NonNullable<ReturnType<typeof getDb>>;

async function searchSops(
  db: Db,
  viewer: SopViewer,
  q: string
): Promise<{ sops: SopHit[]; error?: string }> {
  const [{ data, error }, { data: categories, error: categoriesError }] = await Promise.all([
    db.from('sops').select('*'),
    db.from('sop_categories').select('name, sort_order'),
  ]);
  if (error) return { sops: [], error: error.message };
  if (categoriesError) return { sops: [], error: categoriesError.message };

  const visible = ((data ?? []) as SopRow[]).filter((sop) => canViewSop(viewer, sop));
  const sorted = sortSops(visible, (categories ?? []) as CategoryRank[]);

  const hits: SopHit[] = [];
  for (const sop of sorted) {
    const inContent = searchEntries(sop.content_md, q, ENTRIES_PER_SOP);
    const titleMatches = countMatches(sop.title, q);
    if (inContent.count + titleMatches === 0) continue;
    hits.push({
      id: sop.id,
      slug: sop.slug,
      title: sop.title,
      category: sop.category,
      archived: sop.archived,
      titleMatch: titleMatches > 0,
      matchCount: inContent.count + titleMatches,
      entries: inContent.entries,
    });
  }
  // Live documents before archived ones, library order within each; the
  // palette then lifts title matches above entry matches itself.
  hits.sort((a, b) => Number(a.archived) - Number(b.archived));
  return { sops: hits.slice(0, MAX_SOPS) };
}

async function searchNotes(
  db: Db,
  viewer: { email: string; isAdmin: boolean },
  q: string
): Promise<{ notes: NoteHit[]; error?: string }> {
  let query = db
    .from('shift_notes')
    .select('*')
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(NOTE_SCAN_LIMIT);
  // Same split as /api/admin/shift-notes: the whole log for admins, your own
  // notes for everyone else — and nothing for a session with no email.
  if (!viewer.isAdmin) query = query.eq('author_email', viewer.email || '\0');

  const { data, error } = await query;
  if (error) return { notes: [], error: error.message };

  const rows = ((data ?? []) as ShiftNoteRow[]).filter((note) => canSeeNote(note, viewer));
  const people = await getPeopleNames(rows.map((note) => note.author_email));

  const notes: NoteHit[] = [];
  for (const note of rows) {
    const [entry] = searchEntries(note.body, q, 1).entries;
    if (!entry) continue;
    notes.push({
      id: note.id,
      note_date: note.note_date,
      author_email: note.author_email,
      author: personName(note.author_email, people),
      snippet: entry.text,
    });
    if (notes.length >= MAX_NOTES) break;
  }
  return { notes };
}

async function searchTasks(
  db: Db,
  access: PageAccess,
  q: string
): Promise<{ tasks: TaskHit[]; error?: string }> {
  let boards: Awaited<ReturnType<typeof loadBoards>>;
  let columns: Awaited<ReturnType<typeof loadAllColumns>>;
  try {
    [boards, columns] = await Promise.all([loadBoards(db), loadAllColumns(db)]);
  } catch (e) {
    return { tasks: [], error: e instanceof Error ? e.message : String(e) };
  }
  const visible = visibleBoards(access, boards);
  if (visible.length === 0) return { tasks: [] };
  const boardById = new Map(visible.map((board) => [board.id, board]));
  const columnById = new Map(columns.map((column) => [column.id, column]));

  const { data, error } = await db
    .from('board_cards')
    .select('*')
    .in('board_id', [...boardById.keys()])
    .order('completed_at', { ascending: false, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .limit(CARD_SCAN_LIMIT);
  if (error) return { tasks: [], error: error.message };

  // Same matcher as the SOPs and notes, so a term finds a card the way it
  // finds a line. Title hits first, then notes hits, each in scan order.
  const titleHits: { card: BoardCardRow; snippet: string | null }[] = [];
  const noteHits: { card: BoardCardRow; snippet: string | null }[] = [];
  for (const card of (data ?? []) as BoardCardRow[]) {
    if (matchesTerm(card.title, q)) {
      titleHits.push({ card, snippet: null });
      continue;
    }
    if (noteHits.length >= MAX_TASKS) continue;
    const [entry] = searchEntries(card.notes_md, q, 1).entries;
    if (entry) noteHits.push({ card, snippet: entry.text });
  }
  const hits = [...titleHits, ...noteHits].slice(0, MAX_TASKS);
  const people = await getPeopleNames(hits.flatMap(({ card }) => card.assignee_emails));

  const tasks: TaskHit[] = [];
  for (const { card, snippet } of hits) {
    const board = boardById.get(card.board_id);
    if (!board) continue;
    const column = columnById.get(card.column_id);
    tasks.push({
      id: card.id,
      title: card.title,
      boardSlug: board.slug,
      boardName: board.name,
      cardNoun: board.card_noun,
      column: column?.label ?? '',
      finished: column ? isFinishedKind(column.kind) : card.completed_at !== null,
      owner: card.assignee_emails.map((assignee) => personName(assignee, people)).join(', '),
      dueDate: card.due_date,
      snippet,
    });
  }
  return { tasks };
}

async function searchInventoryItems(
  db: Db,
  q: string,
  editable: boolean
): Promise<{ inventory: InventoryHit[]; error?: string }> {
  // The catalogue is small (tens of items), so it is read whole and matched
  // with the same matcher as everything else rather than in SQL.
  const [items, categories, areas, spots, stock] = await Promise.all([
    db.from('inventory_items').select('*').eq('active', true),
    db.from('inventory_categories').select('*'),
    db.from('inventory_areas').select('*'),
    db.from('inventory_item_spots').select('*'),
    db.from('inventory_stock').select('*'),
  ]);
  // Inventory is one extra group, so a failed read drops only that group
  // (logged) rather than failing the whole search — e.g. while a deploy is
  // live before the migration that adds a table it reads has run.
  for (const result of [items, categories, areas, spots, stock]) {
    if (result.error) {
      console.error('[search] inventory read failed:', result.error.message);
      return { inventory: [] };
    }
  }
  const inventory = searchInventory(
    {
      items: ((items.data ?? []) as InventoryItemRow[]).map((i) => ({
        ...i,
        reorder_level: i.reorder_level == null ? null : Number(i.reorder_level),
      })),
      categories: (categories.data ?? []) as InventoryCategoryRow[],
      areas: (areas.data ?? []) as InventoryAreaRow[],
      spots: (spots.data ?? []) as InventorySpotRow[],
      stock: ((stock.data ?? []) as InventoryStockRow[]).map((s) => ({
        ...s,
        quantity: Number(s.quantity),
      })),
    },
    q,
    { max: MAX_INVENTORY, editable }
  );
  return { inventory };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const q = url.searchParams.get('q')?.trim() ?? '';
  if (queryLength(q) < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
    return json(
      { error: `q must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters` },
      400
    );
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  const canSops = canViewPage(gate.access, '/admin/sops');
  const canNotes = canViewPage(gate.access, SHIFT_NOTES_HREF);
  const canTasks = canViewBoardsTool(gate.access);
  const canInventory = canViewPage(gate.access, INVENTORY_HREF);

  const none = {
    sops: [] as SopHit[],
    notes: [] as NoteHit[],
    tasks: [] as TaskHit[],
    inventory: [] as InventoryHit[],
    error: undefined,
  };
  const [sopResult, noteResult, taskResult, inventoryResult] = await Promise.all([
    canSops
      ? getSopRole(email, gate.access).then((role) => searchSops(db, { role, email }, q))
      : Promise.resolve(none),
    canNotes
      ? searchNotes(db, { email: normalizeEmail(gate.user.email), isAdmin: gate.access.isAdmin }, q)
      : Promise.resolve(none),
    canTasks ? searchTasks(db, gate.access, q) : Promise.resolve(none),
    // Editing items is admin-only, so only admins' hits link to the edit form.
    canInventory ? searchInventoryItems(db, q, gate.access.isAdmin) : Promise.resolve(none),
  ]);
  if (sopResult.error) return json({ error: sopResult.error }, 500);
  if (noteResult.error) return json({ error: noteResult.error }, 500);
  if (taskResult.error) return json({ error: taskResult.error }, 500);
  if (inventoryResult.error) return json({ error: inventoryResult.error }, 500);

  const body: SearchResponse = {
    q,
    sops: sopResult.sops,
    notes: noteResult.notes,
    tasks: taskResult.tasks,
    inventory: inventoryResult.inventory,
  };
  return json(body);
};
