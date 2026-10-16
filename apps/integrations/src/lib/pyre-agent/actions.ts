// Board changes Pyre Agent proposes, from the agent's tool call to the row the
// chat shows with Apply and Dismiss (public.pyre_agent_actions).
//
// Proposing checks the change against the live boards and the asker's own
// access, turns the agent's names into ids (a board by slug, a column by key
// or label, a person by name or email), and stores the exact request the
// dashboard's board API takes — so a proposal the person could never apply
// is refused while the agent can still fix it, and what they see on the card
// is what will happen. Nothing here writes to a board: applying replays the
// stored request through the board routes as the person
// (/api/admin/agent-actions), so their grants, the routes' rules, the
// trails, and the notifications all work exactly as if they had clicked it
// through themselves. Server-only.

import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageAccess } from '@/components/admin/adminTools';
import { canManageBoards, canViewBoard } from '@/lib/boards/access';
import { columnKeyOf } from '@/lib/boards/columns';
import { listAssignable } from '@/lib/boards/people';
import { canReachGoal, loadBoardBySlug, loadCard, loadColumns } from '@/lib/boards/store';
import { BOARD_LIMITS } from '@/lib/boards/types';
import { parseBoardCreate, parseCardCreate, parseCardPatch } from '@/lib/boards/validate';
import type { BoardColumnRow, BoardRow, GoalKpiRow, PyreAgentActionRow } from '@/lib/db';
import { isUuid } from '@/lib/http/json';
import { cardHref } from '@/lib/suggestions/types';
import type { ActionKind, ActionRequest, ActionView, ApplyStep } from './types';
import { boardHref } from './workspace';

export type ProposeResult = { ok: true; action: ActionView } | { ok: false; error: string };

interface Proposal {
  kind: ActionKind;
  summary: string;
  details: string[];
  steps: ApplyStep[];
  /** What the change lands on, when it already exists: the card's link after applying. */
  target?: { label: string; href: string };
}

type Checked = { ok: true; proposal: Proposal } | { ok: false; error: string };

const MAX_RATIONALE = 2000;
const MAX_INITIAL_CARDS = 15;
const DEFAULT_COLUMNS = [
  { label: 'To do', kind: 'open' },
  { label: 'Doing', kind: 'open' },
  { label: 'Done', kind: 'done' },
  { label: 'Dropped', kind: 'dropped' },
] as const;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/** A column by key or label (either case), live and on this board. */
function findColumn(columns: BoardColumnRow[], name: string): BoardColumnRow | null {
  const wanted = name.trim().toLowerCase();
  return (
    columns.find((c) => !c.archived && c.key === wanted) ??
    columns.find((c) => !c.archived && c.label.toLowerCase() === wanted) ??
    null
  );
}

function columnNames(columns: BoardColumnRow[]): string {
  return columns
    .filter((c) => !c.archived)
    .map((c) => `${c.label} (${c.key})`)
    .join(', ');
}

/**
 * People named by email, full name, or a first name only one person on the
 * roster has. Returns the emails, or the names it could not place.
 */
async function resolvePeople(
  names: unknown
): Promise<{ ok: true; emails: string[]; labels: string[] } | { ok: false; error: string }> {
  if (!Array.isArray(names)) return fail('assignees must be a list of names or emails');
  const roster = await listAssignable();
  const emails: string[] = [];
  const labels: string[] = [];
  for (const raw of names) {
    const name = str(raw).toLowerCase();
    if (!name) continue;
    const exact =
      roster.find((p) => p.email.toLowerCase() === name) ??
      roster.find((p) => p.name.toLowerCase() === name);
    const byFirst = roster.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === name);
    const person = exact ?? (byFirst.length === 1 ? byFirst[0] : null);
    if (!person) {
      return fail(
        byFirst.length > 1
          ? `"${raw}" could be ${byFirst.map((p) => p.name).join(' or ')}; use the full name`
          : `Nobody on the roster is called "${raw}"`
      );
    }
    if (!emails.includes(person.email)) {
      emails.push(person.email);
      labels.push(person.name);
    }
  }
  if (emails.length > BOARD_LIMITS.assignees) {
    return fail(`A card can be on ${BOARD_LIMITS.assignees} people at most`);
  }
  return { ok: true, emails, labels };
}

/** YYYY-MM-DD, null to clear, or undefined when absent. */
function dateInput(
  value: unknown,
  field: string
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: true, value };
  return fail(`${field} must be a YYYY-MM-DD date, or null to clear it`);
}

async function liveBoard(
  db: SupabaseClient,
  access: PageAccess,
  slug: string
): Promise<
  { ok: true; board: BoardRow; columns: BoardColumnRow[] } | { ok: false; error: string }
> {
  if (!slug) return fail('board is required (a board slug from get_goals_and_boards)');
  const board = canViewBoard(access, slug) ? await loadBoardBySlug(db, slug) : null;
  if (!board || board.archived) return fail(`No active board "${slug}" this person can open`);
  return { ok: true, board, columns: await loadColumns(db, board.id) };
}

/** A new card on an existing board. */
async function proposeCardCreate(
  db: SupabaseClient,
  access: PageAccess,
  input: Record<string, unknown>
): Promise<Checked> {
  const found = await liveBoard(db, access, str(input.board));
  if (!found.ok) return found;
  const { board, columns } = found;

  let column: BoardColumnRow | null = null;
  if (str(input.column)) {
    column = findColumn(columns, str(input.column));
    if (!column)
      return fail(
        `No column "${str(input.column)}" on ${board.name}; it has ${columnNames(columns)}`
      );
    if (column.kind === 'dropped') return fail(`"${column.label}" is for dropped work`);
  }
  const due = dateInput(input.dueDate, 'dueDate');
  if (!due.ok) return due;
  const people = input.assignees === undefined ? null : await resolvePeople(input.assignees);
  if (people && !people.ok) return people;

  const body: Record<string, unknown> = {
    board: board.slug,
    title: str(input.title),
    notesMd: str(input.notes),
    ...(column ? { columnId: column.id } : {}),
    ...(due.value ? { dueDate: due.value } : {}),
    ...(people && people.emails.length > 0 ? { assigneeEmails: people.emails } : {}),
  };
  const parsed = parseCardCreate(body);
  if (!parsed.ok) return fail(parsed.error);

  const details = [
    column ? `In ${column.label}` : null,
    due.value ? `Due ${due.value}` : null,
    people && people.labels.length > 0
      ? `On ${people.labels.join(', ')}`
      : board.default_assignee_emails.length > 0
        ? "On the board's default people"
        : null,
    str(input.notes) ? clip(str(input.notes), 400) : null,
  ].filter((line): line is string => Boolean(line));

  return {
    ok: true,
    proposal: {
      kind: 'board_card.create',
      summary: clip(`New ${board.card_noun} on ${board.name}: ${parsed.value.title}`, 300),
      details,
      steps: [{ method: 'POST', path: '/api/admin/board-cards', body }],
    },
  };
}

/** A change to an existing card: move it, re-date it, re-assign it, rename it, re-note it. */
async function proposeCardUpdate(
  db: SupabaseClient,
  access: PageAccess,
  input: Record<string, unknown>
): Promise<Checked> {
  if (!isUuid(input.cardId))
    return fail('cardId must be the id of a card from find_cards or read_board');
  const card = await loadCard(db, input.cardId);
  const { data } = card
    ? await db.from('boards').select('*').eq('id', card.board_id).maybeSingle()
    : { data: null };
  const board = data as BoardRow | null;
  if (!card || !board || !canViewBoard(access, board.slug)) {
    return fail('No card with that id on a board this person can open');
  }
  const columns = await loadColumns(db, board.id);
  const body: Record<string, unknown> = { id: card.id };
  const details: string[] = [];

  if (str(input.title) && str(input.title) !== card.title) {
    body.title = str(input.title);
    details.push(`Rename to "${body.title}"`);
  }
  if (str(input.column)) {
    const column = findColumn(columns, str(input.column));
    if (!column)
      return fail(
        `No column "${str(input.column)}" on ${board.name}; it has ${columnNames(columns)}`
      );
    if (column.id !== card.column_id) {
      const from = columns.find((c) => c.id === card.column_id)?.label ?? 'its column';
      body.columnId = column.id;
      details.push(`Move from ${from} to ${column.label}`);
    }
  }
  const due = dateInput(input.dueDate, 'dueDate');
  if (!due.ok) return due;
  if (due.value !== undefined && due.value !== card.due_date) {
    body.dueDate = due.value;
    details.push(
      due.value === null
        ? `Clear the due date (was ${card.due_date})`
        : `Due ${due.value}${card.due_date ? ` (was ${card.due_date})` : ''}`
    );
  }
  if (input.assignees !== undefined) {
    const people = await resolvePeople(input.assignees);
    if (!people.ok) return people;
    body.assigneeEmails = people.emails;
    details.push(
      people.labels.length > 0 ? `Put it on ${people.labels.join(', ')}` : 'Unassign everyone'
    );
  }
  if (input.waitingOn !== undefined) {
    const waiting = input.waitingOn === null ? null : str(input.waitingOn) || null;
    body.waitingOn = waiting;
    details.push(waiting ? `Waiting on: ${waiting}` : 'Clear what it is waiting on');
  }
  if (typeof input.notes === 'string' && input.notes.trim() !== card.notes_md) {
    body.notesMd = input.notes.trim();
    details.push(`Replace the notes: ${clip(input.notes.trim(), 300)}`);
  }
  if (Object.keys(body).length === 1) return fail('That would not change anything on the card');

  const parsed = parseCardPatch(body);
  if (!parsed.ok) return fail(parsed.error);

  return {
    ok: true,
    proposal: {
      kind: 'board_card.update',
      summary: clip(`Update "${card.title}" on ${board.name}`, 300),
      details,
      steps: [{ method: 'PATCH', path: '/api/admin/board-cards', body }],
      target: { label: card.title, href: cardHref(board.slug, card.id) },
    },
  };
}

async function proposeCardComment(
  db: SupabaseClient,
  access: PageAccess,
  input: Record<string, unknown>
): Promise<Checked> {
  if (!isUuid(input.cardId))
    return fail('cardId must be the id of a card from find_cards or read_board');
  const card = await loadCard(db, input.cardId);
  const { data } = card
    ? await db.from('boards').select('slug, name').eq('id', card.board_id).maybeSingle()
    : { data: null };
  const board = data as Pick<BoardRow, 'slug' | 'name'> | null;
  if (!card || !board || !canViewBoard(access, board.slug)) {
    return fail('No card with that id on a board this person can open');
  }
  const note = str(input.note);
  if (!note || note.length > BOARD_LIMITS.comment) {
    return fail(`note must be 1–${BOARD_LIMITS.comment} characters`);
  }
  return {
    ok: true,
    proposal: {
      kind: 'board_card.comment',
      summary: clip(`Comment on "${card.title}"`, 300),
      details: [clip(note, 600)],
      steps: [{ method: 'POST', path: '/api/admin/board-events', body: { cardId: card.id, note } }],
      target: { label: card.title, href: cardHref(board.slug, card.id) },
    },
  };
}

/** "Q4 Marketing!" → "q4-marketing", made unique among the boards. */
async function freeSlug(db: SupabaseClient, name: string): Promise<string> {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/, '');
  if (!/^[a-z]/.test(base)) base = `board-${base}`.replace(/-+$/, '');
  if (base.length < 2) base = 'board';
  const { data } = await db.from('boards').select('slug').like('slug', `${base}%`);
  const taken = new Set(((data ?? []) as { slug: string }[]).map((b) => b.slug));
  let slug = base;
  for (
    let n = 2;
    taken.has(slug) || ['tasks', 'all-goals', 'calendar', 'new'].includes(slug);
    n += 1
  ) {
    slug = `${base}-${n}`;
  }
  return slug;
}

/** A new board — its columns, the goal it serves, and its first cards. */
async function proposeBoardCreate(
  db: SupabaseClient,
  access: PageAccess,
  input: Record<string, unknown>
): Promise<Checked> {
  if (!canManageBoards(access)) {
    return fail(
      'This person can work in boards they were given but cannot create boards; suggest it to someone who holds the Boards tool'
    );
  }
  const name = str(input.name);
  const slug = str(input.slug) || (name ? await freeSlug(db, name) : '');

  const rawColumns =
    Array.isArray(input.columns) && input.columns.length > 0 ? input.columns : DEFAULT_COLUMNS;
  const taken: string[] = [];
  const columns = rawColumns.map((raw, index) => {
    const column = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const label = str(column.label);
    const key = columnKeyOf(label || `column ${index + 1}`, taken);
    taken.push(key);
    return { key, label, kind: str(column.kind) || 'open', sortOrder: (index + 1) * 10 };
  });
  if (!columns.some((c) => c.kind === 'open'))
    return fail('A board needs at least one open column');
  if (!columns.some((c) => c.kind === 'done')) return fail('A board needs a done column');

  const body: Record<string, unknown> = {
    slug,
    name,
    description: str(input.description),
    cardNoun: str(input.cardNoun) || 'task',
    columns,
  };

  // The goal it serves: an existing one by id, a new one, or none.
  let goalLine: string | null = null;
  if (input.goalId !== undefined && input.goalId !== null && input.goalId !== '') {
    if (!isUuid(input.goalId)) return fail('goalId must be a goal id from get_goals_and_boards');
    const { data } = await db
      .from('goals')
      .select('id, title')
      .eq('id', input.goalId)
      .maybeSingle();
    const goal = data as { id: string; title: string } | null;
    if (!goal) return fail('No goal with that id');
    const { data: serving } = await db
      .from('boards')
      .select('name')
      .eq('goal_id', goal.id)
      .eq('archived', false);
    if ((serving ?? []).length > 0) {
      return fail(
        `"${goal.title}" already has a board (${(serving as { name: string }[])[0].name}); propose cards there instead`
      );
    }
    body.goalId = goal.id;
    goalLine = `Serves the goal "${goal.title}"`;
  } else if (input.goal && typeof input.goal === 'object') {
    const goal = input.goal as Record<string, unknown>;
    const target = dateInput(goal.targetDate, 'goal.targetDate');
    if (!target.ok) return target;
    body.goal = {
      title: str(goal.title),
      descriptionMd: str(goal.description),
      status: str(goal.status) || 'active',
      ...(target.value ? { targetDate: target.value } : {}),
    };
    goalLine = `New goal: "${str(goal.title)}"${target.value ? `, by ${target.value}` : ''}`;
  }

  const parsed = parseBoardCreate(body);
  if (!parsed.ok) return fail(parsed.error);
  if (await loadBoardBySlug(db, parsed.value.slug)) {
    return fail(`A board already uses the slug "${parsed.value.slug}"`);
  }

  // Its first cards, made in the new board's columns once it exists.
  const rawCards = Array.isArray(input.cards) ? input.cards : [];
  if (rawCards.length > MAX_INITIAL_CARDS)
    return fail(`At most ${MAX_INITIAL_CARDS} starting cards`);
  const cardSteps: ApplyStep[] = [];
  const cardLines: string[] = [];
  for (const [index, raw] of rawCards.entries()) {
    const card = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const due = dateInput(card.dueDate, `cards[${index}].dueDate`);
    if (!due.ok) return due;
    const people = card.assignees === undefined ? null : await resolvePeople(card.assignees);
    if (people && !people.ok) return people;
    let key: string | null = null;
    if (str(card.column)) {
      const wanted = str(card.column).toLowerCase();
      const column = columns.find((c) => c.key === wanted || c.label.toLowerCase() === wanted);
      if (!column) return fail(`cards[${index}]: no column "${str(card.column)}" on the new board`);
      key = column.key;
    }
    const cardBody: Record<string, unknown> = {
      board: parsed.value.slug,
      title: str(card.title),
      notesMd: str(card.notes),
      ...(due.value ? { dueDate: due.value } : {}),
      ...(people && people.emails.length > 0 ? { assigneeEmails: people.emails } : {}),
    };
    const checked = parseCardCreate(cardBody);
    if (!checked.ok) return fail(`cards[${index}]: ${checked.error}`);
    cardSteps.push({
      method: 'POST',
      path: '/api/admin/board-cards',
      body: cardBody,
      ...(key ? { resolveColumn: { board: parsed.value.slug, key } } : {}),
    });
    cardLines.push(
      `Card: ${checked.value.title}${due.value ? ` (due ${due.value})` : ''}${people && people.labels.length > 0 ? ` — ${people.labels.join(', ')}` : ''}`
    );
  }

  return {
    ok: true,
    proposal: {
      kind: 'board.create',
      summary: clip(`New board: ${parsed.value.name}`, 300),
      details: [
        `Columns: ${columns.map((c) => c.label).join(', ')}`,
        ...(goalLine ? [goalLine] : []),
        ...(parsed.value.description ? [clip(parsed.value.description, 300)] : []),
        ...cardLines,
      ],
      steps: [{ method: 'POST', path: '/api/admin/boards', body }, ...cardSteps],
    },
  };
}

/** A new reading on a KPI. */
async function proposeKpiMeasure(
  db: SupabaseClient,
  access: PageAccess,
  input: Record<string, unknown>
): Promise<Checked> {
  if (!isUuid(input.kpiId)) return fail('kpiId must be a KPI id from get_goals_and_boards');
  const { data } = await db.from('goal_kpis').select('*').eq('id', input.kpiId).maybeSingle();
  const kpi = data as GoalKpiRow | null;
  if (!kpi || !(canManageBoards(access) || (await canReachGoal(db, access, kpi.goal_id)))) {
    return fail('No KPI with that id on a goal this person can work');
  }
  const value = typeof input.value === 'number' ? input.value : Number(input.value);
  if (!Number.isFinite(value)) return fail('value must be a number');
  const { data: goal } = await db.from('goals').select('title').eq('id', kpi.goal_id).maybeSingle();
  const unit = kpi.unit ? ` ${kpi.unit}` : '';
  const { data: boardRow } = await db
    .from('boards')
    .select('slug')
    .eq('goal_id', kpi.goal_id)
    .eq('archived', false)
    .limit(1)
    .maybeSingle();
  const slug = (boardRow as { slug: string } | null)?.slug;
  return {
    ok: true,
    proposal: {
      kind: 'goal_kpi.measure',
      summary: clip(`Set ${kpi.name} to ${value}${unit}`, 300),
      details: [
        `Goal: ${(goal as { title: string } | null)?.title ?? 'unknown'}`,
        `Was ${kpi.current_value ?? 'not measured'}${kpi.current_value !== null ? unit : ''}; target ${kpi.target_value}${unit}`,
        `Measured as of ${todayEastern()}`,
      ],
      steps: [
        {
          method: 'PATCH',
          path: '/api/admin/goal-kpis',
          body: { id: kpi.id, currentValue: value },
        },
      ],
      ...(slug ? { target: { label: kpi.name, href: boardHref(slug) } } : {}),
    },
  };
}

const PROPOSERS: Record<
  ActionKind,
  (db: SupabaseClient, access: PageAccess, input: Record<string, unknown>) => Promise<Checked>
> = {
  'board.create': proposeBoardCreate,
  'board_card.create': proposeCardCreate,
  'board_card.update': proposeCardUpdate,
  'board_card.comment': proposeCardComment,
  'goal_kpi.measure': proposeKpiMeasure,
};

export function actionView(row: PyreAgentActionRow): ActionView {
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    details: Array.isArray(row.details) ? row.details.filter((d) => typeof d === 'string') : [],
    rationale: row.rationale,
    status: row.status,
    resultLabel: row.result_label,
    resultHref: row.result_href,
    error: row.error,
    createdAt: row.created_at,
  };
}

/** Check a proposal and store it pending; the chat shows it with Apply and Dismiss. */
export async function proposeAction(
  db: SupabaseClient,
  access: PageAccess,
  context: { email: string; sessionId: string; turnId: string | null },
  kind: ActionKind,
  input: Record<string, unknown>
): Promise<ProposeResult> {
  const checked = await PROPOSERS[kind](db, access, input);
  if (!checked.ok) return checked;
  const { proposal } = checked;
  const request: ActionRequest & { target?: Proposal['target'] } = {
    steps: proposal.steps,
    ...(proposal.target ? { target: proposal.target } : {}),
  };
  const { data, error } = await db
    .from('pyre_agent_actions')
    .insert({
      session_id: context.sessionId,
      turn_id: context.turnId,
      asked_by: context.email,
      kind,
      summary: proposal.summary,
      details: proposal.details,
      rationale: str(input.rationale).slice(0, MAX_RATIONALE),
      request,
    })
    .select('*')
    .single();
  if (error) return fail(`Could not save the proposal: ${error.message}`);
  return { ok: true, action: actionView(data as PyreAgentActionRow) };
}

/** What one replayed call answered. */
export interface StepResponse {
  status: number;
  body: Record<string, unknown>;
}

const ALLOWED_STEPS = new Set([
  'POST /api/admin/board-cards',
  'PATCH /api/admin/board-cards',
  'POST /api/admin/board-events',
  'POST /api/admin/boards',
  'PATCH /api/admin/goal-kpis',
]);

/** The stored request, re-checked: only the board routes, only as recorded. */
export function readRequest(
  row: Pick<PyreAgentActionRow, 'request'>
): (ActionRequest & { target?: { label: string; href: string } }) | null {
  const request = row.request as { steps?: unknown; target?: unknown };
  if (!Array.isArray(request.steps) || request.steps.length === 0) return null;
  const steps = request.steps as ApplyStep[];
  if (
    !steps.every(
      (s) => s && ALLOWED_STEPS.has(`${s.method} ${s.path}`) && s.body && typeof s.body === 'object'
    )
  ) {
    return null;
  }
  const target = request.target as { label?: unknown; href?: unknown } | undefined;
  return {
    steps,
    ...(target && typeof target.label === 'string' && typeof target.href === 'string'
      ? { target: { label: target.label, href: target.href } }
      : {}),
  };
}

/**
 * Replay an action's calls in order through `run` (the route, as the
 * person). The first call is the change itself; for a new board, the rest
 * are its starting cards, and one of those failing leaves the board made
 * and says which cards did not land. Returns the link to what it made.
 */
export async function replayAction(
  db: SupabaseClient,
  row: PyreAgentActionRow,
  run: (step: ApplyStep) => Promise<StepResponse>
): Promise<
  | { ok: true; label: string; href: string | null; warning: string | null }
  | { ok: false; error: string }
> {
  const request = readRequest(row);
  if (!request) return fail('This proposal is malformed and cannot be applied');

  const [first, ...rest] = request.steps;
  const head = await run(first);
  if (head.status >= 300) {
    return fail(
      typeof head.body.error === 'string'
        ? head.body.error
        : `The change failed (HTTP ${head.status})`
    );
  }

  let label = request.target?.label ?? row.summary;
  let href = request.target?.href ?? null;
  const board = head.body.board as { slug?: string; name?: string } | undefined;
  const card = head.body.card as { id?: string; title?: string } | undefined;
  if (row.kind === 'board.create' && board?.slug) {
    label = board.name ?? board.slug;
    href = boardHref(board.slug);
  } else if (row.kind === 'board_card.create' && card?.id) {
    label = card.title ?? label;
    href = cardHref(String(first.body.board), card.id);
  }

  const failed: string[] = [];
  for (const step of rest) {
    let body = step.body;
    if (step.resolveColumn) {
      const target = await loadBoardBySlug(db, step.resolveColumn.board);
      const column = target
        ? (await loadColumns(db, target.id)).find((c) => c.key === step.resolveColumn?.key)
        : null;
      if (column) body = { ...body, columnId: column.id };
    }
    const response = await run({ ...step, body });
    if (response.status >= 300) failed.push(String(step.body.title ?? 'a card'));
  }
  return {
    ok: true,
    label,
    href,
    warning: failed.length > 0 ? `These cards could not be added: ${failed.join(', ')}` : null,
  };
}
