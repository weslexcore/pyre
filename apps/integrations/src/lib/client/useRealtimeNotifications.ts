// Live inbox updates for the bell. Subscribes the browser's Supabase client
// to the signed-in person's private notification channel (see
// lib/notifications/realtime and the staff_notifications_realtime
// migration) and calls `onChange` when a row of theirs is written — a
// mention, a reply, a schedule change — so the bell refetches at once
// instead of on its next minute tick.
//
// The access token comes from /api/auth/realtime-token through the shared
// JSON cache, so navigating between admin pages reuses it rather than
// asking again on every header remount; a timer asks for a fresh one
// shortly before it expires. Returns whether the channel is live, so the
// caller can let its poll stand down while it is.

import { useEffect, useRef, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { NOTIFICATION_EVENT } from '@/lib/notifications/realtime';
import { getBrowserSupabase } from '@/lib/supabase/client';

const TOKEN_URL = '/api/auth/realtime-token';
/** Tokens last about an hour; keep one for most of it. */
const TOKEN_MAX_AGE_MS = 50 * 60_000;
/** Ask for the next token this long before the current one expires. */
const REFRESH_LEAD_MS = 60_000;
/** "Mark all read" writes a burst of rows; one refetch covers them. */
const COALESCE_MS = 250;

interface TokenResponse {
  url: string;
  key: string;
  accessToken: string;
  expiresAt: number | null;
  topic: string;
}

export function useRealtimeNotifications(onChange: () => void): boolean {
  const { data: token, reload } = useCachedJson<TokenResponse>(TOKEN_URL, {
    maxAgeMs: TOKEN_MAX_AGE_MS,
    freshMs: TOKEN_MAX_AGE_MS,
  });
  const [live, setLive] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!token?.expiresAt) return;
    const wait = Math.max(5_000, token.expiresAt - Date.now() - REFRESH_LEAD_MS);
    const timer = setTimeout(() => void reload(), wait);
    return () => clearTimeout(timer);
  }, [token, reload]);

  useEffect(() => {
    if (!token) return;
    const client = getBrowserSupabase(token.url, token.key);

    void client.realtime.setAuth(token.accessToken);
    let pending: ReturnType<typeof setTimeout> | null = null;
    const channel = client
      .channel(token.topic, { config: { private: true } })
      .on('broadcast', { event: NOTIFICATION_EVENT }, () => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => onChangeRef.current(), COALESCE_MS);
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => {
      if (pending) clearTimeout(pending);
      setLive(false);
      void client.removeChannel(channel);
    };
  }, [token]);

  return live;
}
