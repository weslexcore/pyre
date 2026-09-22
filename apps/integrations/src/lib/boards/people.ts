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

import type { PageAccess } from '@/components/admin/adminTools';
import { listStaff } from '@/lib/auth/access';
import type { BoardCardRow, StaffRow } from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { canManageBoards, canViewBoard, canWorkGoal } from './access';

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
  return byName(
    (rows ?? []).filter((row) =>
      canViewBoard({ isAdmin: row.is_admin, pages: row.pages ?? [] }, slug)
    )
  );
}

function byName(rows: StaffRow[]): Assignable[] {
  return rows
    .filter((row) => row.active && (row.email ?? '').trim())
    .map((row) => {
      const email = (row.email ?? '').trim().toLowerCase();
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
}

/** Today in America/New_York — the wall clock a due date is read against. */
export function todayEastern(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * The per-viewer half of a board bundle: names for the emails on the board,
 * the assignable roster if this viewer may have it, and whether they may
 * reshape the board at all.
 */
export async function boardViewerExtras(
  cards: Pick<BoardCardRow, 'owner_email' | 'created_by' | 'completed_by'>[],
  access: PageAccess,
  slug: string
): Promise<ViewerExtras> {
  const canManage = canManageBoards(access);
  const people = await getPeopleNames(
    cards.flatMap((card) => [card.owner_email ?? '', card.created_by, card.completed_by ?? ''])
  );
  const owners = canManage ? await listAssignable() : [];
  return {
    people,
    owners,
    canManage,
    canWorkGoal: canWorkGoal(access, slug),
    today: todayEastern(),
  };
}
