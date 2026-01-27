// React hook for fetching events from the API endpoint
// Includes client-side sessionStorage caching for performance

import { useCallback, useEffect, useState } from 'react';
import type { EventItem } from '@/lib/types';

const CACHE_KEY = 'pyre-events-cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  events: EventItem[];
  timestamp: number;
}

interface UseEventsResult {
  events: EventItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function getCachedEvents(): EventItem[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const entry: CacheEntry = JSON.parse(cached);
    const age = Date.now() - entry.timestamp;

    if (age < CACHE_TTL_MS) {
      return entry.events;
    }

    // Cache expired, remove it
    sessionStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

function setCachedEvents(events: EventItem[]): void {
  if (typeof window === 'undefined') return;

  try {
    const entry: CacheEntry = {
      events,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

export function useEvents(fallbackEvents: EventItem[] = []): UseEventsResult {
  const [events, setEvents] = useState<EventItem[]>(fallbackEvents);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    // Check cache first
    const cached = getCachedEvents();
    if (cached) {
      setEvents(cached);
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
      const fetchedEvents = data.events || [];

      setCachedEvents(fetchedEvents);
      setEvents(fetchedEvents);
    } catch (err) {
      console.error('[useEvents] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
      // Use fallback events on error (only if we have them)
      if (fallbackEvents.length > 0) {
        setEvents(fallbackEvents);
      }
    } finally {
      setLoading(false);
    }
  }, [fallbackEvents]);

  const refetch = useCallback(async () => {
    // Clear cache before refetching
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(CACHE_KEY);
    }
    await fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch };
}
