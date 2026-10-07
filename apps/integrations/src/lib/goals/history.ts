// One line of history, in words. Pure and client-safe.
//
// The events table stores what changed as `{ field: { from, to } }`, which is
// the right thing to store and the wrong thing to read. This turns a row into
// the sentence a person would say: "moved it to In progress", "measured
// Consecutive weeks: 2 → 3", "assigned to Maya". Column ids become labels and
// emails become names here, so the feed never shows a UUID.

import type { BoardColumnRow, BoardEventRow } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { GOAL_STATUS_LABELS, isGoalStatus } from './types';

/** Human labels for the fields that collapse into an `updated` event. */
const FIELD_LABELS: Record<string, string> = {
  title: 'the title',
  notes_md: 'the notes',
  description_md: 'the description',
  waiting_on: 'what it is waiting on',
  area: 'the area',
  goal_id: 'the goal it is filed under',
  parent_id: 'its parent goal',
  properties: 'the details',
  // A rule changes both columns at once; one name for the pair.
  repeat_every: 'how often it repeats',
  repeat_unit: 'how often it repeats',
};

interface Change {
  from: unknown;
  to: unknown;
}

function changeOf(detail: Record<string, unknown>, field: string): Change | null {
  const raw = detail[field];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const change = raw as Record<string, unknown>;
  return 'from' in change || 'to' in change ? { from: change.from, to: change.to } : null;
}

function str(value: unknown): string {
  return typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? ''
      : String(value);
}

function numberish(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'number' ? String(value) : String(value);
}

/** A list read as English: "the title", "the title and the notes", "a, b and c". */
function sentenceList(items: string[]): string {
  if (items.length === 0) return 'something';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function emails(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** "assigned it to Maya and Jo", "took Jo off it", or both in one line. */
function describeAssignees(change: Change, people: PeopleNames): string {
  const from = emails(change.from);
  const to = emails(change.to);
  const added = to.filter((email) => !from.includes(email));
  const removed = from.filter((email) => !to.includes(email));
  const names = (list: string[]) => sentenceList(list.map((email) => personName(email, people)));
  if (to.length === 0) return 'took everyone off it';
  const parts: string[] = [];
  if (added.length > 0) parts.push(`assigned it to ${names(added)}`);
  if (removed.length > 0) parts.push(`took ${names(removed)} off it`);
  return parts.length > 0 ? parts.join(' and ') : 'reordered who is on it';
}

/**
 * What this event says, without the actor's name (the feed puts that in
 * front). `subjectTitle` is the goal or card the event is about, used where
 * the sentence reads better with it.
 */
export function describeEvent(
  event: Pick<BoardEventRow, 'action' | 'detail' | 'note'>,
  subjectTitle: string,
  columnsById: Map<string, Pick<BoardColumnRow, 'label'>>,
  people: PeopleNames
): string {
  const detail = event.detail ?? {};

  switch (event.action) {
    case 'created':
      // The next copy of a repeating card, filed when the last one finished —
      // how repeats worked before a finished card went back for its next round.
      if (typeof detail.repeatOf === 'string') return 'filed the next repeat';
      return subjectTitle ? `added “${subjectTitle}”` : 'added it';

    case 'comment':
      return event.note ?? '';

    case 'moved': {
      const change = changeOf(detail, 'column_id');
      const to = change ? columnsById.get(str(change.to))?.label : undefined;
      const from = change ? columnsById.get(str(change.from))?.label : undefined;
      // A repeating card finished and sent back for its next round.
      if (detail.repeated === true) {
        const due = str(changeOf(detail, 'due_date')?.to);
        const back = to ? `back to ${to}` : 'back';
        return `finished this round; it repeats, so it went ${back}${due ? `, due ${due}` : ''}`;
      }
      if (to && from) return `moved it from ${from} to ${to}`;
      if (to) return `moved it to ${to}`;
      return 'moved it';
    }

    case 'assigned': {
      // A card's list of assignees; older card events and goals name one owner.
      const list = changeOf(detail, 'assignee_emails');
      if (list) return describeAssignees(list, people);
      const change = changeOf(detail, 'owner_email');
      const to = str(change?.to);
      if (!to) return 'took the owner off it';
      return `assigned it to ${personName(to, people)}`;
    }

    case 'due_changed': {
      const change = changeOf(detail, 'due_date') ?? changeOf(detail, 'target_date');
      const to = str(change?.to);
      if (!to) return 'cleared the date';
      return `set the date to ${to}`;
    }

    case 'status_changed': {
      const change = changeOf(detail, 'status');
      const to = str(change?.to);
      const from = str(change?.from);
      const toLabel = isGoalStatus(to) ? GOAL_STATUS_LABELS[to] : to;
      const fromLabel = isGoalStatus(from) ? GOAL_STATUS_LABELS[from] : from;
      if (toLabel && fromLabel) return `moved it from ${fromLabel} to ${toLabel}`;
      if (toLabel) return `marked it ${toLabel}`;
      return 'changed its status';
    }

    case 'linked':
    case 'unlinked': {
      // A card_link answer gained or lost a card (lib/boards/card-links).
      // The title is the one it had then; the label is absent on the far
      // end of a one-way link, which has no field of its own to name.
      const title = str(detail.title);
      const label = str(detail.label);
      const what = title ? `“${title}”` : 'a card';
      const under = label ? ` under ${label}` : '';
      return event.action === 'linked' ? `linked ${what}${under}` : `unlinked ${what}${under}`;
    }

    case 'kpi_updated': {
      const name = str(detail.name) || 'a KPI';
      return `measured ${name}: ${numberish(detail.from)} → ${numberish(detail.to)}`;
    }

    case 'completed': {
      const kpisMet = detail.kpisMet;
      const kpisTotal = detail.kpisTotal;
      const openCards = detail.openCards;
      const parts: string[] = [];
      if (typeof kpisTotal === 'number' && kpisTotal > 0) {
        parts.push(`${kpisMet} of ${kpisTotal} KPIs met`);
      }
      if (typeof openCards === 'number' && openCards > 0) {
        parts.push(`${openCards} task${openCards === 1 ? '' : 's'} still open`);
      }
      const summary = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
      return `marked it completed${summary}`;
    }

    default: {
      const fields = [...new Set(Object.keys(detail).map((key) => FIELD_LABELS[key] ?? key))];
      return `changed ${sentenceList(fields)}`;
    }
  }
}

/** "2 days ago" / "just now" — how the feed times a line. */
export function timeAgo(iso: string, nowIso: string): string {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return '';
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}
