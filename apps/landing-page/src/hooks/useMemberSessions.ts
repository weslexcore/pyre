// React hook for fetching member sessions
// Includes cancel functionality

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemberSession } from '@/lib/momence-member-types';

interface UseMemberSessionsOptions {
  type?: 'upcoming' | 'attended';
}

/**
 * Why the last cancel failed. Kept apart from the list's load `error`, so a
 * failed cancel leaves the bookings on screen. `not_authenticated` means the
 * sign-in expired; otherwise `message` is the server's explanation, if any.
 */
export interface CancelError {
  bookingId: number;
  reason: 'not_authenticated' | 'failed';
  message?: string;
}

interface UseMemberSessionsResult {
  sessions: MemberSession[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  cancelSession: (bookingId: number) => Promise<boolean>;
  cancelling: number | null; // bookingId being cancelled
  cancelError: CancelError | null;
}

export function useMemberSessions(options: UseMemberSessionsOptions = {}): UseMemberSessionsResult {
  const { type = 'upcoming' } = options;
  const [sessions, setSessions] = useState<MemberSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<CancelError | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/member/sessions?type=${type}`);

      if (response.status === 401) {
        setError('not_authenticated');
        setSessions([]);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('[useMemberSessions] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, [type]);

  // A ref, not state: two clicks in one frame both see the state from before
  // either re-render, so state alone can't stop a double submit.
  const cancelInFlight = useRef(false);

  const cancelSession = useCallback(async (bookingId: number): Promise<boolean> => {
    if (cancelInFlight.current) return false;
    cancelInFlight.current = true;
    setCancelling(bookingId);
    setCancelError(null);

    try {
      const response = await fetch(`/api/member/sessions/${bookingId}`, {
        method: 'DELETE',
      });

      if (response.status === 401) {
        setCancelError({ bookingId, reason: 'not_authenticated' });
        return false;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        console.error('[useMemberSessions] Cancel failed:', response.status, data.error);
        setCancelError({ bookingId, reason: 'failed', message: data.message });
        return false;
      }

      // Remove the cancelled session from local state
      setSessions((prev) => prev.filter((s) => s.bookingId !== bookingId));

      return true;
    } catch (err) {
      console.error('[useMemberSessions] Cancel error:', err);
      setCancelError({ bookingId, reason: 'failed' });
      return false;
    } finally {
      cancelInFlight.current = false;
      setCancelling(null);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return {
    sessions,
    loading,
    error,
    refetch: fetchSessions,
    cancelSession,
    cancelling,
    cancelError,
  };
}
