// The bell in the admin header: a badge with the unread count, and a
// popover of the latest unread rows with a link to the full inbox. The
// count is painted by the server on every page (initialCount), so opening a
// page costs no extra request; from there a slow poll while the tab is
// visible keeps it fresh, opening the popover fetches the rows, and the
// NOTIFICATIONS_EVENT the inbox and thread islands fire after they mark
// rows read updates it in place. Header islands remount on every
// ClientRouter navigation, so the poll timer never outlives a page.
// Popover mechanics follow AdminNav.
import { useCallback, useEffect, useRef, useState } from 'react';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { StaffNotificationRow } from '@/lib/db';
import { isUnread, NOTIFICATIONS_EVENT } from '@/lib/notifications/types';
import { NOTIFICATIONS_HREF } from './adminTools';
import { readError } from './messagesUi';
import { NotificationList } from './NotificationList';

const POLL_MS = 60_000;
const POPOVER_LIMIT = 5;
const FEED_URL = `/api/admin/notifications?limit=${POPOVER_LIMIT}`;

interface FeedResponse {
  notifications: StaffNotificationRow[];
  unreadCount: number;
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 2a4.5 4.5 0 0 0-4.5 4.5V10L3 12.5h12L13.5 10V6.5A4.5 4.5 0 0 0 9 2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.25 15a1.75 1.75 0 0 0 3.5 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Whatever the feed says is the count now — the server prop was right at
  // render time, and any island that changes it fires the event below.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(FEED_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as FeedResponse;
      setFeed(data);
      setCount(data.unreadCount);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      if (typeof detail === 'number') setCount(detail);
      invalidateJson('/api/admin/notifications');
    };
    document.addEventListener(NOTIFICATIONS_EVENT, onEvent);
    return () => document.removeEventListener(NOTIFICATIONS_EVENT, onEvent);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      if (!v) void reload();
      return !v;
    });
  }, [reload]);

  const markAllRead = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, read: true }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { unreadCount: number };
      setCount(data.unreadCount);
      setFeed((prev) =>
        prev ? { ...prev, unreadCount: data.unreadCount, notifications: [] } : prev
      );
      invalidateJson('/api/admin/notifications');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark read');
    } finally {
      setBusy(false);
    }
  };

  const markOneRead = (n: StaffNotificationRow) => {
    if (!isUnread(n)) return;
    setCount((c) => Math.max(0, c - 1));
    void fetch('/api/admin/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [n.id], read: true }),
      keepalive: true,
    }).finally(() => invalidateJson('/api/admin/notifications'));
  };

  const unread = (feed?.notifications ?? []).filter((n) => isUnread(n));
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={toggle}
        className="relative flex h-10 w-10 items-center justify-center rounded-md border border-white/20 text-[var(--pyre-creme)] transition-colors hover:border-white/40 hover:bg-white/10"
      >
        <BellIcon />
        {count > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pyre-red)] px-1 font-mono text-[10px] font-bold text-white"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notification-panel"
          className="absolute inset-x-0 top-full z-50 mt-2 flex max-h-[calc(100dvh-5rem)] flex-col border-t border-white/10 bg-[var(--pyre-black)] shadow-lg md:inset-x-auto md:right-0 md:w-80 md:rounded-md md:border md:border-white/10"
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-white/40">
              {count > 0 ? `${count} unread` : 'All caught up'}
            </span>
            {count > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void markAllRead()}
                className="font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-white disabled:opacity-40"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {error && <p className="px-3 py-2 text-xs text-[var(--pyre-red)]">{error}</p>}
            {loading && !feed ? (
              <p className="px-3 py-4 text-center text-xs text-white/40">Loading…</p>
            ) : (
              <NotificationList
                notifications={unread}
                compact
                emptyText="No unread notifications."
                onOpen={markOneRead}
              />
            )}
          </div>
          <a
            href={NOTIFICATIONS_HREF}
            data-astro-prefetch="tap"
            className="border-t border-white/10 px-3 py-2.5 text-center font-mono text-xs font-bold uppercase tracking-wide text-[var(--pyre-creme)] hover:bg-white/10 hover:text-white"
          >
            All notifications
          </a>
        </div>
      )}
    </div>
  );
}
