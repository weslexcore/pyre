// The inbox's pure rules, shared by the bell, the /admin/notifications
// island, and the routes (client-bundle-safe: no db/env imports).
//
// A row is live until it is dismissed or expires; live and unopened is
// unread, which is what the bell counts. Dismissing is the reader's choice;
// expiry is the event's — a shift change stops mattering the day after the
// shift, an SOP edit a couple of weeks on.

import { addDays, weekStartOf } from '@pyre/schedule-core';
import type { NotificationKind, StaffNotificationRow } from '@/lib/db';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'admin_message',
  'message_reply',
  'sop_updated',
  'schedule_change',
  'shift_note_reply',
  'sub_request',
  'goal_activity',
];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** Chip text per kind. */
export const KIND_LABELS: Record<NotificationKind, string> = {
  admin_message: 'Message',
  message_reply: 'Reply',
  sop_updated: 'SOP',
  schedule_change: 'Schedule',
  shift_note_reply: 'Shift note',
  sub_request: 'Sub',
  goal_activity: 'Goals',
};

/** The subset of a row the rules below read. */
export type NotificationState = Pick<
  StaffNotificationRow,
  'read_at' | 'dismissed_at' | 'expires_at' | 'created_at'
>;

/** Still belongs in the inbox: not dismissed, not past its expiry. */
export function isLive(n: NotificationState, nowIso: string = new Date().toISOString()): boolean {
  if (n.dismissed_at) return false;
  return !n.expires_at || n.expires_at > nowIso;
}

/** Live and never opened — what the badge counts. */
export function isUnread(n: NotificationState, nowIso: string = new Date().toISOString()): boolean {
  return isLive(n, nowIso) && !n.read_at;
}

/** Unread rows first, newest first within each group. */
export function sortInbox<T extends NotificationState>(rows: T[], nowIso?: string): T[] {
  const now = nowIso ?? new Date().toISOString();
  return [...rows].sort((a, b) => {
    const ua = isUnread(a, now) ? 0 : 1;
    const ub = isUnread(b, now) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** What swiping an inbox row does: left clears it, right flips its read state. */
export type InboxSwipe = 'dismiss' | 'read' | 'unread';

/**
 * The action a release at this finger delta would commit on a row, or null
 * when that direction isn't offered where the row is drawn.
 */
export function inboxSwipeAction(
  unread: boolean,
  dx: number,
  offered: { dismiss: boolean; toggleRead: boolean }
): InboxSwipe | null {
  if (dx < 0) return offered.dismiss ? 'dismiss' : null;
  if (dx > 0) return offered.toggleRead ? (unread ? 'read' : 'unread') : null;
  return null;
}

/**
 * The first line or so of a markdown body as plain text, for the row under
 * a message notification: headings, emphasis, links, and code marks are
 * stripped rather than rendered, and the result is cut at `max` characters
 * on a word boundary.
 */
export function excerpt(markdown: string, max = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+(\[[ xX!]\]\s+)?/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** ISO instant `days` days after now. */
export function daysFromNow(days: number, nowMs: number = Date.now()): string {
  return new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * When a notice about a shift stops mattering: two days after the shift's
 * wall-clock date, which lands after the shift has ended in any US zone.
 */
export function shiftNotificationExpiry(shiftDate: string): string {
  return new Date(
    new Date(`${shiftDate}T00:00:00Z`).getTime() + 2 * 24 * 60 * 60 * 1000
  ).toISOString();
}

/**
 * Whether a shift falls in the current Monday–Sunday week (`today` is the ET
 * wall-clock date). Only those shifts' changes reach people's inboxes — later
 * weeks are covered by the Monday "your shifts this week" email, so changes
 * made while they're still being planned stay quiet.
 */
export function inCurrentWeek(shiftDate: string, today: string): boolean {
  const weekStart = weekStartOf(today);
  return shiftDate >= weekStart && shiftDate <= addDays(weekStart, 6);
}

/** The board deep link the rest of the schedule tools use. */
export function scheduleHref(shift: { id: string; shift_date: string }): string {
  return `/admin/schedule?view=week&date=${shift.shift_date}&shift=${shift.id}`;
}

/**
 * Fired on `document` by any island that changes the unread count (the inbox
 * marking rows read, a thread opening), so the header bell updates in the
 * same document without a navigation — the tool-pins convention.
 */
export const NOTIFICATIONS_EVENT = 'pyre:notifications';

export function emitUnreadCount(count: number): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent<number>(NOTIFICATIONS_EVENT, { detail: count }));
}
