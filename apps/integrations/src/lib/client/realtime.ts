// The browser's Realtime plumbing, shared by every island that listens for
// live changes (the bell, a checklist, the run log).
//
// useRealtimeSession() holds the one thing they all need: an authenticated
// client. The access token comes from /api/auth/realtime-token through the
// shared JSON cache, so navigating between admin pages reuses it rather than
// asking again on every island mount, and a timer asks for a fresh one
// shortly before it expires (Realtime drops a connection whose token has
// lapsed without a new one). The session itself stays in httpOnly cookies the
// browser cannot read; this hands the client only the short-lived token.
//
// useChannel() subscribes one private channel for as long as the island is
// mounted: database broadcasts arrive as `onChange` (bursts coalesced into
// one call), and, when the island announces itself, Presence keeps the other
// people on the channel in `presence`.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { getBrowserSupabase } from '@/lib/supabase/client';

const TOKEN_URL = '/api/auth/realtime-token';
/** Tokens last about an hour; keep one for most of it. */
const TOKEN_MAX_AGE_MS = 50 * 60_000;
/** Ask for the next token this long before the current one expires. */
const REFRESH_LEAD_MS = 60_000;
/** A burst of row changes ("mark all read", a parent tap) is one refetch. */
const COALESCE_MS = 250;

interface TokenResponse {
  url: string;
  key: string;
  accessToken: string;
  expiresAt: number | null;
  /** The signed-in person's own notification topic. */
  topic: string;
}

export interface RealtimeSession {
  /** Null until the token has arrived (or when Realtime is not configured). */
  client: SupabaseClient | null;
  accessToken: string | null;
  /** The viewer's notification topic, from the token response. */
  notificationTopic: string | null;
}

export function useRealtimeSession(): RealtimeSession {
  const { data: token, reload } = useCachedJson<TokenResponse>(TOKEN_URL, {
    maxAgeMs: TOKEN_MAX_AGE_MS,
    freshMs: TOKEN_MAX_AGE_MS,
  });

  useEffect(() => {
    if (!token?.expiresAt) return;
    const wait = Math.max(5_000, token.expiresAt - Date.now() - REFRESH_LEAD_MS);
    const timer = setTimeout(() => void reload(), wait);
    return () => clearTimeout(timer);
  }, [token, reload]);

  // The client is one per realm; a fresh token is handed to it here, which
  // also re-authorizes every channel already open on it.
  const client = useMemo(() => (token ? getBrowserSupabase(token.url, token.key) : null), [token]);
  useEffect(() => {
    if (client && token) void client.realtime.setAuth(token.accessToken);
  }, [client, token]);

  return {
    client,
    accessToken: token?.accessToken ?? null,
    notificationTopic: token?.topic ?? null,
  };
}

/** The raw Presence state of a channel: one list of payloads per connection. */
export type PresenceState<T> = Record<string, (T & { presence_ref: string })[]>;

export interface ChannelOptions<T extends object> {
  /** A database broadcast arrived (bursts coalesced). */
  onChange: () => void;
  /** What to announce about this viewer; null to listen without announcing. Re-tracked when it changes. */
  announce?: T | null;
}

export interface ChannelState<T> {
  /** The channel is SUBSCRIBED, so broadcasts are arriving and a poll can stand down. */
  live: boolean;
  presence: PresenceState<T>;
}

const NO_PRESENCE = {};

/**
 * One private channel for the life of the island. `topic` null stands down.
 * The broadcast event is always 'changed' (what every trigger sends).
 */
export function useChannel<T extends object>(
  session: RealtimeSession,
  topic: string | null,
  options: ChannelOptions<T>
): ChannelState<T> {
  const [live, setLive] = useState(false);
  const [presence, setPresence] = useState<PresenceState<T>>(NO_PRESENCE as PresenceState<T>);
  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;
  const announceRef = useRef(options.announce ?? null);
  announceRef.current = options.announce ?? null;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const { client } = session;

  useEffect(() => {
    if (!client || !topic) return;

    let pending: ReturnType<typeof setTimeout> | null = null;
    const channel = client.channel(topic, { config: { private: true } });
    channel
      .on('broadcast', { event: 'changed' }, () => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => onChangeRef.current(), COALESCE_MS);
      })
      .on('presence', { event: 'sync' }, () => {
        setPresence({ ...channel.presenceState<T>() });
      })
      .subscribe((status) => {
        const up = status === 'SUBSCRIBED';
        setLive(up);
        if (up && announceRef.current) void channel.track(announceRef.current);
      });
    channelRef.current = channel;

    return () => {
      if (pending) clearTimeout(pending);
      channelRef.current = null;
      setLive(false);
      setPresence(NO_PRESENCE as PresenceState<T>);
      void client.removeChannel(channel);
    };
  }, [client, topic]);

  // A new announcement (the viewer tapped another item) while the channel is
  // up: re-track, which replaces this connection's presence entry.
  const announce = options.announce ?? null;
  useEffect(() => {
    const channel = channelRef.current;
    if (!live || !channel || !announce) return;
    void channel.track(announce);
  }, [live, announce]);

  return { live, presence };
}

/** Listen on one topic for database broadcasts; returns whether the channel is live. */
export function useBroadcastTopic(topic: string | null, onChange: () => void): boolean {
  const session = useRealtimeSession();
  return useChannel<Record<string, never>>(session, topic, { onChange }).live;
}
