// What a Pyre Agent action is, as the server stores it and the chat shows it:
// a change to the boards or the inventory the agent proposed in a
// conversation, applied only when the person in the conversation presses
// Apply. Pure and client-bundle-safe; the checks against live data are in
// ./actions.

export const PYRE_AGENT_HREF = '/admin/ask';

export const ACTION_KINDS = [
  'board.create',
  'board_card.create',
  'board_card.update',
  'board_card.comment',
  'goal_kpi.measure',
  'inventory.update',
  'inventory.create',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** The kinds that act on the boards, and the ones that act on the inventory. */
export const BOARD_ACTION_KINDS: readonly ActionKind[] = [
  'board.create',
  'board_card.create',
  'board_card.update',
  'board_card.comment',
  'goal_kpi.measure',
];
export const INVENTORY_ACTION_KINDS: readonly ActionKind[] = [
  'inventory.update',
  'inventory.create',
];

export type ActionStatus = 'pending' | 'applying' | 'applied' | 'dismissed';

export const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  'board.create': 'New board',
  'board_card.create': 'New task',
  'board_card.update': 'Task change',
  'board_card.comment': 'Comment',
  'goal_kpi.measure': 'KPI measurement',
  'inventory.update': 'Inventory change',
  'inventory.create': 'New inventory item',
};

/**
 * One dashboard API call applying replays, as the person. `query` is the
 * call's query string (the inventory routes take the item as ?id=).
 * `columnKey` names a column on `board` to resolve into the body's columnId
 * at apply time — a card proposed onto a board the same action creates has
 * no column id yet.
 */
export interface ApplyStep {
  method: 'POST' | 'PATCH';
  path: string;
  query?: Record<string, string>;
  body: Record<string, unknown>;
  resolveColumn?: { board: string; key: string };
}

/** The `request` column: the calls in order; the first one's result is the link. */
export interface ActionRequest {
  steps: ApplyStep[];
}

/** An action as the chat reads it. */
export interface ActionView {
  id: string;
  kind: ActionKind;
  summary: string;
  details: string[];
  rationale: string;
  status: ActionStatus;
  resultLabel: string | null;
  resultHref: string | null;
  error: string | null;
  createdAt: string;
}

/** The tools whose results carry a proposal for the chat to render. */
export function isProposeTool(tool: string): boolean {
  return tool.startsWith('propose_');
}

/** The proposal ids in a propose tool's output (JSON with { proposal: { id } }). */
export function proposalIdOf(output: string | undefined): string | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as { proposal?: { id?: unknown } };
    return typeof parsed.proposal?.id === 'string' ? parsed.proposal.id : null;
  } catch {
    return null;
  }
}
