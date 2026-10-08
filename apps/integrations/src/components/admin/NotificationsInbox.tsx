// /admin/notifications: everything live in the viewer's inbox, unread
// first. Rows can be opened (which reads them), marked read all at once,
// swiped read or unread one by one, or dismissed; each change is applied to the list immediately and
// written through, and the header bell hears about the new count via the
// NOTIFICATIONS_EVENT so it updates without a navigation.
//
// The list narrows by read state and by kind (one chip per kind present,
// with its unread count); the filter lives in the URL so a reload or a
// shared link lands on the same view. "Mark read" follows the filter. The
// Preferences panel sets which kinds reach the inbox at all.
import { useEffect, useMemo, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { readError } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { StaffNotificationRow } from '@/lib/db';
import {
  emitUnreadCount,
  filterInbox,
  type InboxFilter,
  inboxFilterSearch,
  isUnread,
  KIND_DETAILS,
  kindCounts,
  parseInboxFilter,
  sortInbox,
} from '@/lib/notifications/types';
import { buttonClass, chipClass } from './messagesUi';
import { KIND_STYLE, NotificationList } from './NotificationList';
import { NotificationPreferences } from './NotificationPreferences';

// The full inbox is the one reader that also asks for the dead-row sweep.
const FEED_URL = '/api/admin/notifications?limit=200&sweep=1';

interface FeedResponse {
  notifications: StaffNotificationRow[];
  unreadCount: number;
}

const DEFAULT_FILTER: InboxFilter = { unreadOnly: false, kind: null };

async function patch(body: Record<string, unknown>): Promise<{ unreadCount: number }> {
  const res = await fetch('/api/admin/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { unreadCount: number };
}

function emptyText(filter: InboxFilter, total: number): string {
  if (total === 0) return 'No notifications yet.';
  const kind = filter.kind ? KIND_DETAILS[filter.kind].label.toLowerCase() : null;
  if (filter.unreadOnly) return kind ? `No unread ${kind}.` : 'No unread notifications.';
  return kind ? `No ${kind} in your inbox.` : 'No notifications yet.';
}

export function NotificationsInbox() {
  const feed = useCachedJson<FeedResponse>(FEED_URL);
  const [filter, setFilterState] = useState<InboxFilter>(DEFAULT_FILTER);
  const [showPrefs, setShowPrefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The URL is read after mount (the server render has no location), so the
  // first paint is the default view and the filter follows a beat later.
  useEffect(() => {
    setFilterState(parseInboxFilter(window.location.search));
  }, []);

  const setFilter = (next: InboxFilter) => {
    setFilterState(next);
    const url = `${window.location.pathname}${inboxFilterSearch(next)}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  };

  const rows = useMemo(() => sortInbox(feed.data?.notifications ?? []), [feed.data]);
  const unreadCount = rows.filter((n) => isUnread(n)).length;
  const counts = useMemo(() => kindCounts(rows), [rows]);
  const shown = filterInbox(rows, filter);
  // What "Mark read" covers: the whole inbox, or the chosen kind's unread rows.
  const unreadInView = filter.kind
    ? filterInbox(rows, { unreadOnly: true, kind: filter.kind })
    : null;
  const markableCount = unreadInView ? unreadInView.length : unreadCount;

  const settle = (unread: number) => {
    emitUnreadCount(unread);
    invalidateJson('/api/admin/notifications');
  };

  const markAllRead = async () => {
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    const ids = unreadInView ? new Set(unreadInView.map((n) => n.id)) : null;
    feed.setData((prev) =>
      prev
        ? {
            ...prev,
            unreadCount: ids ? Math.max(0, prev.unreadCount - ids.size) : 0,
            notifications: prev.notifications.map((n) =>
              n.read_at || (ids && !ids.has(n.id)) ? n : { ...n, read_at: now }
            ),
          }
        : prev
    );
    try {
      const { unreadCount } = await patch(
        ids ? { ids: [...ids], read: true } : { all: true, read: true }
      );
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

  const toggleRead = async (n: StaffNotificationRow, read: boolean) => {
    setError(null);
    const readAt = read ? new Date().toISOString() : null;
    feed.setData((prev) =>
      prev
        ? {
            ...prev,
            notifications: prev.notifications.map((r) =>
              r.id === n.id ? { ...r, read_at: readAt } : r
            ),
          }
        : prev
    );
    try {
      const { unreadCount } = await patch({ ids: [n.id], read });
      settle(unreadCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
      await feed.reload();
    }
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

  const statusButton = (unreadOnly: boolean, label: string) => (
    <button
      type="button"
      onClick={() => setFilter({ ...filter, unreadOnly })}
      aria-pressed={filter.unreadOnly === unreadOnly}
      className={`${buttonClass} ${filter.unreadOnly === unreadOnly ? 'border-white/40 text-white' : ''}`}
    >
      {label}
    </button>
  );

  const kindLabel = filter.kind ? KIND_DETAILS[filter.kind].label : null;
  // A chosen kind stays on the bar after its last row goes, so the view
  // doesn't silently jump back to everything.
  const chips =
    filter.kind && !counts.some((c) => c.kind === filter.kind)
      ? [...counts, { kind: filter.kind, total: 0, unread: 0 }]
      : counts;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {statusButton(false, 'All')}
        {statusButton(true, `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`)}
        <div className="ml-auto flex items-center gap-2">
          {feed.refreshing && (
            <span className="font-mono text-[10px] text-white/30">refreshing…</span>
          )}
          <button
            type="button"
            className={buttonClass}
            disabled={busy || markableCount === 0}
            onClick={() => void markAllRead()}
          >
            {kindLabel ? `Mark ${kindLabel} read` : 'Mark all read'}
          </button>
          <button
            type="button"
            className={`${buttonClass} ${showPrefs ? 'border-white/40 text-white' : ''}`}
            aria-expanded={showPrefs}
            aria-controls="notification-prefs"
            onClick={() => setShowPrefs((open) => !open)}
          >
            Preferences
          </button>
        </div>
      </div>

      {showPrefs && (
        <div id="notification-prefs">
          <NotificationPreferences />
        </div>
      )}

      {chips.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Show notifications of type</legend>
          <button
            type="button"
            onClick={() => setFilter({ ...filter, kind: null })}
            aria-pressed={filter.kind === null}
            className={`${chipClass} ${
              filter.kind === null
                ? 'border-white/50 bg-white/10 text-white'
                : 'border-white/15 text-white/50 hover:border-white/30 hover:text-white/80'
            }`}
          >
            All types
          </button>
          {chips.map(({ kind, total, unread }) => {
            const active = filter.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setFilter({ ...filter, kind: active ? null : kind })}
                aria-pressed={active}
                title={`${KIND_DETAILS[kind].label}: ${total} in your inbox, ${unread} unread`}
                className={`${chipClass} ${KIND_STYLE[kind]} ${
                  active ? 'bg-white/10 ring-1 ring-current' : 'opacity-70 hover:opacity-100'
                }`}
              >
                {KIND_DETAILS[kind].label}
                <span className="ml-1.5 opacity-70">
                  {unread > 0 ? `${unread}/${total}` : total}
                </span>
              </button>
            );
          })}
        </fieldset>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}
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
          emptyText={emptyText(filter, rows.length)}
          onOpen={open}
          onDismiss={(n) => void dismissRow(n)}
          onToggleRead={(n, read) => void toggleRead(n, read)}
        />
      )}
    </div>
  );
}
