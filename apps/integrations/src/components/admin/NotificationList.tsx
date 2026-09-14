// The rows of someone's inbox, drawn the same way in the bell's popover and
// on /admin/notifications: a kind chip, the title (a link when the event has
// a page to open), the detail line, when it happened, an unread dot, and a
// dismiss button. Reading and dismissing are the parent's to persist — this
// component only says which row was touched.

import { timeAgo } from '@/lib/client/relativeTime';
import type { StaffNotificationRow } from '@/lib/db';
import { isUnread, KIND_LABELS } from '@/lib/notifications/types';
import { formatStamp } from './messagesUi';

const KIND_STYLE: Record<StaffNotificationRow['kind'], string> = {
  admin_message: 'border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]',
  message_reply: 'border-[var(--pyre-gold)]/30 text-[var(--pyre-gold)]/80',
  sop_updated: 'border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]',
  schedule_change: 'border-[var(--pyre-red)]/50 text-[var(--pyre-red)]',
  shift_note_reply: 'border-white/20 text-white/60',
  sub_request: 'border-[var(--pyre-red)]/30 text-[var(--pyre-red)]/80',
};

export function NotificationList({
  notifications,
  compact = false,
  emptyText = 'Nothing here.',
  onOpen,
  onDismiss,
}: {
  notifications: StaffNotificationRow[];
  /** Tighter rows for the popover. */
  compact?: boolean;
  emptyText?: string;
  /** The row was clicked (its link is about to navigate). */
  onOpen?: (notification: StaffNotificationRow) => void;
  /** Absent = rows can't be dismissed here (the popover). */
  onDismiss?: (notification: StaffNotificationRow) => void;
}) {
  if (notifications.length === 0) {
    return (
      <p className={`${compact ? 'px-3 py-4' : 'py-8'} text-center text-sm text-white/40`}>
        {emptyText}
      </p>
    );
  }

  return (
    <ul className={compact ? 'divide-y divide-white/5' : 'space-y-2'}>
      {notifications.map((n) => {
        const unread = isUnread(n);
        const title = n.href ? (
          <a
            href={n.href}
            data-astro-prefetch="tap"
            onClick={() => onOpen?.(n)}
            className="text-sm font-semibold text-[var(--pyre-creme)] hover:text-white hover:underline"
          >
            {n.title}
          </a>
        ) : (
          <span className="text-sm font-semibold text-[var(--pyre-creme)]">{n.title}</span>
        );
        return (
          <li
            key={n.id}
            data-unread={unread ? 'true' : undefined}
            className={
              compact
                ? 'flex items-start gap-2 px-3 py-2.5'
                : `flex items-start gap-3 rounded border px-3 py-2.5 ${
                    unread ? 'border-white/20 bg-white/5' : 'border-white/10'
                  }`
            }
          >
            <span
              title={unread ? 'Unread' : undefined}
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                unread ? 'bg-[var(--pyre-red)]' : 'bg-transparent'
              }`}
            >
              {unread && <span className="sr-only">Unread</span>}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${KIND_STYLE[n.kind]}`}
                >
                  {KIND_LABELS[n.kind]}
                </span>
                {title}
              </div>
              {n.body && !compact && <p className="mt-0.5 text-sm text-white/60">{n.body}</p>}
              {n.body && compact && (
                <p className="mt-0.5 truncate text-xs text-white/50">{n.body}</p>
              )}
              <div
                className="mt-1 font-mono text-[10px] text-white/30"
                title={formatStamp(n.created_at)}
              >
                {timeAgo(n.created_at)}
              </div>
            </div>
            {onDismiss && (
              <button
                type="button"
                aria-label={`Dismiss: ${n.title}`}
                title="Dismiss"
                onClick={() => onDismiss(n)}
                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-xs text-white/40 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
