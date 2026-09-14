// /admin/notifications: everything live in the viewer's inbox, unread
// first. Rows can be opened (which reads them), marked read all at once, or
// dismissed one by one; each change is applied to the list immediately and
// written through, and the header bell hears about the new count via the
// NOTIFICATIONS_EVENT so it updates without a navigation.
import { useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { StaffNotificationRow } from '@/lib/db';
import { emitUnreadCount, isUnread, sortInbox } from '@/lib/notifications/types';
import { buttonClass, readError } from './messagesUi';
import { NotificationList } from './NotificationList';

// The full inbox is the one reader that also asks for the dead-row sweep.
const FEED_URL = '/api/admin/notifications?limit=200&sweep=1';

interface FeedResponse {
  notifications: StaffNotificationRow[];
  unreadCount: number;
}

type Filter = 'all' | 'unread';

async function patch(body: Record<string, unknown>): Promise<{ unreadCount: number }> {
  const res = await fetch('/api/admin/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { unreadCount: number };
}

export function NotificationsInbox() {
  const feed = useCachedJson<FeedResponse>(FEED_URL);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => sortInbox(feed.data?.notifications ?? []), [feed.data]);
  const unreadCount = rows.filter((n) => isUnread(n)).length;
  const shown = filter === 'unread' ? rows.filter((n) => isUnread(n)) : rows;

  const settle = (unread: number) => {
    emitUnreadCount(unread);
    invalidateJson('/api/admin/notifications');
  };

  const markAllRead = async () => {
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    feed.setData((prev) =>
      prev
        ? {
            ...prev,
            unreadCount: 0,
            notifications: prev.notifications.map((n) => (n.read_at ? n : { ...n, read_at: now })),
          }
        : prev
    );
    try {
      const { unreadCount } = await patch({ all: true, read: true });
      settle(unreadCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark read');
      await feed.reload();
    } finally {
      setBusy(false);
    }
  };

  const open = (n: StaffNotificationRow) => {
    if (!isUnread(n)) return;
    const now = new Date().toISOString();
    feed.setData((prev) =>
      prev
        ? {
            ...prev,
            notifications: prev.notifications.map((r) =>
              r.id === n.id ? { ...r, read_at: now } : r
            ),
          }
        : prev
    );
    void fetch('/api/admin/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [n.id], read: true }),
      keepalive: true,
    }).finally(() => invalidateJson('/api/admin/notifications'));
    emitUnreadCount(Math.max(0, unreadCount - 1));
  };

  const dismissRow = async (n: StaffNotificationRow) => {
    setError(null);
    feed.setData((prev) =>
      prev ? { ...prev, notifications: prev.notifications.filter((r) => r.id !== n.id) } : prev
    );
    try {
      const { unreadCount } = await patch({ ids: [n.id], dismissed: true });
      settle(unreadCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to dismiss');
      await feed.reload();
    }
  };

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={`${buttonClass} ${filter === value ? 'border-white/40 text-white' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filterButton('all', 'All')}
        {filterButton('unread', `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`)}
        <div className="ml-auto flex items-center gap-2">
          {feed.refreshing && (
            <span className="font-mono text-[10px] text-white/30">refreshing…</span>
          )}
          <button
            type="button"
            className={buttonClass}
            disabled={busy || unreadCount === 0}
            onClick={() => void markAllRead()}
          >
            Mark all read
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]"
        >
          {error}
        </p>
      )}
      {feed.error && !feed.data && (
        <p role="alert" className="text-sm text-[var(--pyre-red)]">
          Couldn't load notifications: {feed.error}
        </p>
      )}

      {feed.loading ? (
        <p className="py-8 text-center text-sm text-white/40">Loading…</p>
      ) : (
        <NotificationList
          notifications={shown}
          emptyText={filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
          onOpen={open}
          onDismiss={(n) => void dismissRow(n)}
        />
      )}
    </div>
  );
}
