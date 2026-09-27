// Number and timestamp formatting shared by the /admin islands. Locale and
// timezone are pinned (en-US, the studio's ET clock) wherever the string can
// render on the server and again in the browser: the two have to agree or
// React throws the server tree away.

import { STUDIO_TZ } from '@pyre/schedule-core';

export { fmtDateTime, timeAgo } from './relativeTime';

/** '$1,240' for whole dollars, '$12.50' otherwise. */
export function fmtMoney(n: number): string {
  return `$${Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)}`;
}

/** '6' or '6.5' — hours as the schedule and payroll views show them. */
export function fmtHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** 'Aug 22, 6:04 PM' on the studio's clock. */
export function etStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: STUDIO_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 'Aug 22, 2026, 6:04 PM' on the studio's clock. */
export function etStampWithYear(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: STUDIO_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** '9:42 PM' on the studio's clock. */
export function etTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: STUDIO_TZ,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 'Aug 22' in the viewer's locale, or '—' for no date. Client-only views. */
export function fmtShortDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—';
}
