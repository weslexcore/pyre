// React hook for fetching member credits

import { useCallback, useEffect, useState } from 'react';
import type { MemberCredits } from '@/lib/momence-member-types';

interface UseMemberCreditsResult {
  credits: MemberCredits | null;
  hasCredits: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMemberCredits(): UseMemberCreditsResult {
  const [credits, setCredits] = useState<MemberCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/member/credits');

      if (response.status === 401) {
        setError('not_authenticated');
        setCredits(null);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setCredits(data.credits);
    } catch (err) {
      console.error('[useMemberCredits] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch credits');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  const hasCredits = credits !== null && (credits.unlimited || credits.available > 0);

  return {
    credits,
    hasCredits,
    loading,
    error,
    refetch: fetchCredits,
  };
}
