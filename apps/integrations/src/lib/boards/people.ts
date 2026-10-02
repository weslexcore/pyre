// Who a card or a goal can be handed to, and how much of that a given viewer
// is entitled to see. Server-only (reads the staff table through the cached
// roster in lib/auth/access).
//
// Two different things, kept apart on purpose:
//
//   * `getPeopleNames` (lib/sops/people) answers only for the emails a
//     response already mentions — it turns an owner's address into a name
//     and nothing more.
//   * `listAssignable` *is* the address book. It goes to viewers already
//     entitled to it: the goals pages, and the board pages for whoever holds
//     the whole tool. A single-board grantee — a community manager on the
//     rental pipeline — gets the name map instead, which is enough to read
//     who owns a lead without handing over the staff list.

import { todayEastern } from '@pyre/schedule-core';
import type { PageAccess } from '@/components/admin/adminTools';
import { listStaff } from '@/lib/auth/access';
import type { BoardCardRow, BoardFieldRow, StaffRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { accessOf } from '@/lib/notifications/recipients';
import type { PeopleNames } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { canManageBoards, canViewBoard, canWorkGoal } from './access';
import { checklistPeople } from './checklist';
import { type LinkSummary, markOpenable } from './links';

/** Somebody a goal or a card can be assigned to. */
export interface Assignable {
  email: string;
  name: string;
}

/** Active roster members with an email, by name. */
export async function listAssignable(): Promise<Assignable[]> {
  const rows = await listStaff();
  return byName(rows ?? []);
}

/**
 * Who can open one board, by name. This is the audience a form may pick
 * from when it names the people a submission wakes: a form decides who
 * hears about a card, never who may see the board.
 */
export async function listBoardWatchers(slug: string): Promise<Assignable[]> {
  const rows = await listStaff();
  return byName((rows ?? []).filter((row) => canViewBoard(accessOf(row), slug)));
}

function byName(rows: StaffRow[]): Assignable[] {
  return rows
    .filter((row) => row.active && (row.email ?? '').trim())
    .map((row) => {
      const email = normalizeEmail(row.email);
      return { email, name: (row.display_name ?? '').trim() || email };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ViewerExtras {
  people: PeopleNames;
  owners: Assignable[];
  /** Reshape the board, edit its goal, define its KPIs, call it met. */
  canManage: boolean;
  /** Measure the goal's KPIs and comment on its trail. */
  canWorkGoal: boolean;
  today: string;
  /** The bundle's linked-card summaries, each marked openable or not for this viewer. */
  linkSummaries: LinkSummary[];
  /** Who is looking: a checklist tap is stamped with it until the server's stamp arrives. */
  viewerEmail: string;
}

/**
 * The per-viewer half of a board bundle: names for the emails on the board,
 * the assignable roster if this viewer may have it, and whether they may
 * reshape the board at all.
 */
export async function boardViewerExtras(
  cards: Pick<BoardCardRow, 'owner_email' | 'created_by' | 'completed_by' | 'properties'>[],
  access: PageAccess,
  slug: string,
  linkSummaries: LinkSummary[] = [],
  viewer: { email: string; fields: Pick<BoardFieldRow, 'key' | 'kind'>[] } = {
    email: '',
    fields: [],
  }
): Promise<ViewerExtras> {
  const canManage = canManageBoards(access);
  const people = await getPeopleNames([
    ...cards.flatMap((card) => [card.owner_email ?? '', card.created_by, card.completed_by ?? '']),
    // Whoever ticked an item on a checklist, so the row says a name.
    ...checklistPeople(viewer.fields, cards),
    viewer.email,
  ]);
  const owners = canManage ? await listAssignable() : [];
  return {
    people,
    owners,
    canManage,
    canWorkGoal: canWorkGoal(access, slug),
    today: todayEastern(),
    linkSummaries: markOpenable(linkSummaries, (target) => canViewBoard(access, target)),
    viewerEmail: viewer.email,
  };
}
