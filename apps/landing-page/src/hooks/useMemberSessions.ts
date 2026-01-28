// React hook for fetching member sessions
// Includes cancel functionality

import { useCallback, useEffect, useState } from 'react';
import type { MemberSession } from '@/lib/momence-member-types';

interface UseMemberSessionsOptions {
  type?: 'upcoming' | 'attended';
}

interface UseMemberSessionsResult {
  sessions: MemberSession[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  cancelSession: (bookingId: number) => Promise<boolean>;
  cancelling: number | null; // bookingId being cancelled
}

export function useMemberSessions(
  options: UseMemberSessionsOptions = {}
): UseMemberSessionsResult {
  const { type = 'upcoming' } = options;
  const [sessions, setSessions] = useState<MemberSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

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

  const cancelSession = useCallback(
    async (bookingId: number): Promise<boolean> => {
      setCancelling(bookingId);

      try {
        const response = await fetch(`/api/member/sessions/${bookingId}`, {
          method: 'DELETE',
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.message || 'Cancel failed');
        }

        // Remove the cancelled session from local state
        setSessions((prev) => prev.filter((s) => s.bookingId !== bookingId));

        return true;
      } catch (err) {
        console.error('[useMemberSessions] Cancel error:', err);
        setError(err instanceof Error ? err.message : 'Failed to cancel');
        return false;
      } finally {
        setCancelling(null);
      }
    },
    []
  );

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
  };
}
