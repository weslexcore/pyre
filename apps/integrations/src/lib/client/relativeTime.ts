// Compact timestamp formatting for the /admin islands. Shared so "2h ago"
// means the same thing on every page.

/**
 * Compact distance from now, in either direction: '4m ago', 'in 3h', 'now'.
 * Deliberately coarse — these sit in dense tables and status lines where the
 * shape of the number matters more than its precision. Pair with fmtDateTime
 * in a `title` when the exact instant matters.
 */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const diffMs = nowMs - new Date(iso).getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  let text: string;
  if (mins < 1) text = 'now';
  else if (mins < 60) text = `${mins}m`;
  else if (mins < 48 * 60) text = `${Math.round(mins / 60)}h`;
  else text = `${Math.round(mins / (24 * 60))}d`;
  if (text === 'now') return text;
  return diffMs >= 0 ? `${text} ago` : `in ${text}`;
}

/** 'Aug 22, 6:04 AM' in the viewer's own locale and timezone. */
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
