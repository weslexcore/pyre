// Live inbox updates for the bell. Subscribes to the signed-in person's
// private notification channel (see lib/notifications/realtime and the
// staff_notifications_realtime migration) and calls `onChange` when a row of
// theirs is written — a mention, a reply, a schedule change — so the bell
// refetches at once instead of on its next minute tick. Returns whether the
// channel is live, so the caller can let its poll stand down while it is.

import { useChannel, useRealtimeSession } from '@/lib/client/realtime';

export function useRealtimeNotifications(onChange: () => void): boolean {
  const session = useRealtimeSession();
  return useChannel<Record<string, never>>(session, session.notificationTopic, { onChange }).live;
}
