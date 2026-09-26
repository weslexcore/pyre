// The rows of someone's inbox, drawn the same way in the bell's popover and
// on /admin/notifications: a kind chip, the title (a link when the event has
// a page to open), the detail line, when it happened, an unread dot, and a
// dismiss button. On touch, a row also swipes: left dismisses it, right marks
// it read or unread. Reading and dismissing are the parent's to persist —
// this component only says which row was touched.

import { timeAgo } from '@/lib/client/relativeTime';
import type { StaffNotificationRow } from '@/lib/db';
import {
  type InboxSwipe,
  inboxSwipeAction,
  isUnread,
  KIND_LABELS,
} from '@/lib/notifications/types';
import { formatStamp } from './messagesUi';
import { useRowSwipe } from './useRowSwipe';

const KIND_STYLE: Record<StaffNotificationRow['kind'], string> = {
  admin_message: 'border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]',
  message_reply: 'border-[var(--pyre-gold)]/30 text-[var(--pyre-gold)]/80',
  sop_updated: 'border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]',
  schedule_change: 'border-[var(--pyre-red)]/50 text-[var(--pyre-red)]',
  shift_note_reply: 'border-white/20 text-white/60',
  sub_request: 'border-[var(--pyre-red)]/30 text-[var(--pyre-red)]/80',
  goal_activity: 'border-[var(--pyre-gold)]/40 text-[var(--pyre-gold)]/90',
  agent_suggestion: 'border-[var(--pyre-sage)]/40 text-[var(--pyre-sage)]/90',
};

// What a swipe in progress promises, drawn in the track the row uncovers.
const SWIPE_TONE: Record<InboxSwipe, { tint: string; text: string; label: string }> = {
  dismiss: {
    tint: 'bg-[var(--pyre-red)]/25',
    text: 'text-[var(--pyre-red)]',
    label: 'Dismiss',
  },
  read: { tint: 'bg-white/10', text: 'text-white/70', label: 'Mark read' },
  unread: {
    tint: 'bg-[var(--pyre-gold)]/20',
    text: 'text-[var(--pyre-gold)]',
    label: 'Mark unread',
  },
};

function SwipeReveal({ action, armed }: { action: InboxSwipe | null; armed: boolean }) {
  if (!action) return null;
  const tone = SWIPE_TONE[action];
  // Dismiss is the left swipe, so its label sits on the right edge the row
  // uncovers; the read toggles swipe right and sit on the left.
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 transition-opacity ${tone.tint} ${
        armed ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <div
        className={`absolute inset-y-0 flex items-center px-3 font-mono text-[10px] uppercase tracking-wide ${tone.text} ${
          action === 'dismiss' ? 'right-0' : 'left-0'
        }`}
      >
        {tone.label}
      </div>
    </div>
  );
}

function NotificationRow({
  n,
  compact,
  onOpen,
  onDismiss,
  onToggleRead,
}: {
  n: StaffNotificationRow;
  compact: boolean;
  onOpen?: (notification: StaffNotificationRow) => void;
  onDismiss?: (notification: StaffNotificationRow) => void;
  onToggleRead?: (notification: StaffNotificationRow, read: boolean) => void;
}) {
  const unread = isUnread(n);
  const offered = { dismiss: !!onDismiss, toggleRead: !!onToggleRead };
  const swipe = useRowSwipe<InboxSwipe>({
    enabled: offered.dismiss || offered.toggleRead,
    actionAt: (dx) => inboxSwipeAction(unread, dx, offered),
    onAction: (action) => {
      if (action === 'dismiss') onDismiss?.(n);
      else onToggleRead?.(n, action === 'read');
    },
  });

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
      data-unread={unread ? 'true' : undefined}
      className={`relative touch-pan-y overflow-hidden ${
        compact ? '' : `rounded border ${unread ? 'border-white/20' : 'border-white/10'}`
      }`}
      {...swipe.handlers}
    >
      <SwipeReveal action={swipe.action} armed={swipe.armed} />
      {/* The row rides over the reveal; while it is moving it needs a back
          of its own so the track never shows through the text. */}
      <div
        className={`flex items-start ${compact ? 'gap-2 px-3 py-2.5' : 'gap-3 px-3 py-2.5'} ${
          swipe.dragging
            ? 'select-none bg-[var(--pyre-black)]'
            : `transition-transform duration-200 motion-reduce:transition-none ${
                unread && !compact ? 'bg-white/5' : ''
              }`
        }`}
        style={swipe.dx === 0 ? undefined : { transform: `translateX(${swipe.dx}px)` }}
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
          {n.body && compact && <p className="mt-0.5 truncate text-xs text-white/50">{n.body}</p>}
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
      </div>
    </li>
  );
}

export function NotificationList({
  notifications,
  compact = false,
  emptyText = 'Nothing here.',
  onOpen,
  onDismiss,
  onToggleRead,
}: {
  notifications: StaffNotificationRow[];
  /** Tighter rows for the popover. */
  compact?: boolean;
  emptyText?: string;
  /** The row was clicked (its link is about to navigate). */
  onOpen?: (notification: StaffNotificationRow) => void;
  /** Absent = rows can't be dismissed here. */
  onDismiss?: (notification: StaffNotificationRow) => void;
  /** Absent = rows can't be swiped read or unread here. */
  onToggleRead?: (notification: StaffNotificationRow, read: boolean) => void;
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
      {notifications.map((n) => (
        <NotificationRow
          key={n.id}
          n={n}
          compact={compact}
          onOpen={onOpen}
          onDismiss={onDismiss}
          onToggleRead={onToggleRead}
        />
      ))}
    </ul>
  );
}
