// The words each automatic notification uses — kept pure (no db, no env) so
// the titles and bodies can be tested against fixtures and read the same
// wherever they are produced.

import { timeToMinutes } from '@pyre/schedule-core';

/** "Sat, Sep 20" from YYYY-MM-DD (schedule dates are ET wall-clock already). */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "2:30p" from HH:MM[:SS], the boards' compact time style. */
export function shortTime(t: string): string {
  const min = timeToMinutes(t);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** "9a–1p" */
export function shortWindow(row: { starts_at: string; ends_at: string }): string {
  return `${shortTime(row.starts_at)}–${shortTime(row.ends_at)}`;
}

export interface ShiftLike {
  label: string;
  shift_date: string;
  starts_at: string;
  ends_at: string;
}

export type AssignmentChange = 'added' | 'updated' | 'removed';

/** "'Morning' on Sat, Sep 20" */
function shiftPhrase(shift: ShiftLike): string {
  return `'${shift.label}' on ${shortDate(shift.shift_date)}`;
}

export function assignmentChangeText(input: {
  change: AssignmentChange;
  shift: ShiftLike;
  /** The person's own window on the shift; falls back to the shift's. */
  assignment?: { starts_at: string; ends_at: string; role?: string } | null;
  /** Extra detail for an update ("starts_at 09:00 → 10:00"). */
  detail?: string | null;
  actorName?: string | null;
}): { title: string; body: string } {
  const window = shortWindow(input.assignment ?? input.shift);
  const role =
    input.assignment?.role && input.assignment.role !== 'full' ? ` · ${input.assignment.role}` : '';
  const by = input.actorName ? ` by ${input.actorName}` : '';
  switch (input.change) {
    case 'added':
      return { title: `You're on ${shiftPhrase(input.shift)}`, body: `${window}${role}${by}` };
    case 'updated':
      return {
        title: `Your shift changed: ${shiftPhrase(input.shift)}`,
        body: input.detail ? `${input.detail}${by}` : `Now ${window}${role}${by}`,
      };
    case 'removed':
      return { title: `You were taken off ${shiftPhrase(input.shift)}`, body: `${window}${by}` };
  }
}

export type ShiftChange = 'updated' | 'cancelled' | 'deleted';

export function shiftChangeText(input: {
  change: ShiftChange;
  shift: ShiftLike;
  detail?: string | null;
  actorName?: string | null;
}): { title: string; body: string } {
  const by = input.actorName ? ` by ${input.actorName}` : '';
  switch (input.change) {
    case 'cancelled':
      return {
        title: `Shift cancelled: ${shiftPhrase(input.shift)}`,
        body: `${shortWindow(input.shift)}${by}`,
      };
    case 'deleted':
      return {
        title: `Shift removed: ${shiftPhrase(input.shift)}`,
        body: `${shortWindow(input.shift)}${by}`,
      };
    case 'updated':
      return {
        title: `Shift changed: ${shiftPhrase(input.shift)}`,
        body: `${input.detail ?? `Now ${shortWindow(input.shift)}`}${by}`,
      };
  }
}

export function proposalApprovedText(input: {
  weekStart: string;
  shiftCount: number;
  actorName?: string | null;
}): { title: string; body: string } {
  const n = input.shiftCount;
  return {
    title: `${n} shift${n === 1 ? '' : 's'} published for the week of ${shortDate(input.weekStart)}`,
    body: input.actorName ? `Schedule approved by ${input.actorName}` : 'Schedule approved',
  };
}

export function sopSavedText(input: {
  title: string;
  version: number;
  created: boolean;
  changeNote?: string | null;
  editorName?: string | null;
}): { title: string; body: string } {
  const by = input.editorName ? ` by ${input.editorName}` : '';
  if (input.created) return { title: `New SOP: ${input.title}`, body: `Added${by}` };
  return {
    title: `SOP updated: ${input.title}`,
    body: input.changeNote ? `${input.changeNote}${by}` : `Version ${input.version}${by}`,
  };
}

export type SubEvent = 'requested' | 'claimed' | 'cancelled';

export function subRequestText(input: {
  event: SubEvent;
  shift: ShiftLike;
  window: { starts_at: string; ends_at: string };
  requesterName: string;
  claimerName?: string | null;
  /** The reader is the requester (claimed: "X is covering your shift"). */
  forRequester?: boolean;
  /** The reader could claim it (requested: "Can you cover…?"). */
  forCandidate?: boolean;
}): { title: string; body: string } {
  const when = `${shiftPhrase(input.shift)}, ${shortWindow(input.window)}`;
  switch (input.event) {
    case 'requested':
      return input.forCandidate
        ? { title: `Can you cover ${when}?`, body: `${input.requesterName} needs a sub` }
        : { title: `${input.requesterName} requested a sub`, body: when };
    case 'claimed':
      return input.forRequester
        ? { title: `${input.claimerName ?? 'Someone'} is covering your shift`, body: when }
        : {
            title: `${input.claimerName ?? 'Someone'} is covering for ${input.requesterName}`,
            body: when,
          };
    case 'cancelled':
      return { title: `${input.requesterName} cancelled a sub request`, body: when };
  }
}

export function shiftNoteReplyText(input: {
  noteDate: string;
  replierName: string;
  /** The reader wrote the note. */
  forAuthor: boolean;
  authorName?: string | null;
  excerpt: string;
}): { title: string; body: string } {
  return {
    title: input.forAuthor
      ? `${input.replierName} replied to your shift note for ${shortDate(input.noteDate)}`
      : `${input.replierName} replied on ${input.authorName ?? 'a'} shift note for ${shortDate(input.noteDate)}`,
    body: input.excerpt,
  };
}

export function shiftNoteStatusText(input: {
  noteDate: string;
  status: string;
  adminName: string;
}): { title: string; body: string } {
  const label = input.status === 'todo' ? 'to-do' : input.status;
  return {
    title: `Your shift note for ${shortDate(input.noteDate)} was marked ${label}`,
    body: `by ${input.adminName}`,
  };
}
