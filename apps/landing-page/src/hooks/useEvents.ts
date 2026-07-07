// React hook for fetching events from the API endpoint
// Includes client-side sessionStorage caching for performance

import { useCallback, useEffect, useState } from 'react';
import type { EventItem } from '@/lib/types';

// Bump the version suffix whenever the cached EventItem shape changes so stale
// entries are abandoned rather than served (v2 added `priceUsd`).
const CACHE_KEY = 'pyre-events-cache-v2';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  events: EventItem[];
  timestamp: number;
  hasMore: boolean;
}

interface UseEventsResult {
  events: EventItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  refetch: () => Promise<void>;
  loadAll: () => Promise<void>;
}

function readCache(): CacheEntry | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const entry = JSON.parse(cached) as Partial<CacheEntry>;
    if (!entry || !Array.isArray(entry.events) || typeof entry.timestamp !== 'number') {
      return null;
    }
    const age = Date.now() - entry.timestamp;

    if (age < CACHE_TTL_MS) {
      return {
        events: entry.events,
        timestamp: entry.timestamp,
        hasMore: !!entry.hasMore,
      };
    }

    sessionStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

function writeCache(events: EventItem[], hasMore: boolean): void {
  if (typeof window === 'undefined') return;
  // Never cache an empty list — it may be a transient upstream failure, and
  // caching it would suppress refetches for the full TTL.
  if (events.length === 0) return;

  try {
    const entry: CacheEntry = {
      events,
      timestamp: Date.now(),
      hasMore,
    };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

export function useEvents(fallbackEvents: EventItem[] = []): UseEventsResult {
  const [events, setEvents] = useState<EventItem[]>(fallbackEvents);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchEvents = useCallback(async () => {
    const cached = readCache();
    if (cached) {
      setEvents(cached.events);
      setHasMore(cached.hasMore);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/events');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const fetchedEvents: EventItem[] = data.events || [];
      const fetchedHasMore = !!data.hasMore;

      writeCache(fetchedEvents, fetchedHasMore);
      setEvents(fetchedEvents);
      setHasMore(fetchedHasMore);
    } catch (err) {
      console.error('[useEvents] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
      if (fallbackEvents.length > 0) {
        setEvents(fallbackEvents);
      }
    } finally {
      setLoading(false);
    }
  }, [fallbackEvents]);

  const refetch = useCallback(async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(CACHE_KEY);
    }
    await fetchEvents();
  }, [fetchEvents]);

  const loadAll = useCallback(async () => {
    setLoadingMore(true);
    try {
      const response = await fetch('/api/events?all=1');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const fetchedEvents: EventItem[] = data.events || [];

      writeCache(fetchedEvents, false);
      setEvents(fetchedEvents);
      setHasMore(false);
    } catch (err) {
      console.error('[useEvents] loadAll error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, loadingMore, error, hasMore, refetch, loadAll };
}
