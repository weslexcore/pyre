// React hook for fetching member memberships

import { useCallback, useEffect, useState } from 'react';
import type { MemberMembership } from '@/lib/momence-member-types';

interface UseMemberMembershipsResult {
  memberships: MemberMembership[];
  activeMembership: MemberMembership | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMemberMemberships(): UseMemberMembershipsResult {
  const [memberships, setMemberships] = useState<MemberMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemberships = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/member/memberships');

      if (response.status === 401) {
        setError('not_authenticated');
        setMemberships([]);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setMemberships(data.memberships || []);
    } catch (err) {
      console.error('[useMemberMemberships] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch memberships');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemberships();
  }, [fetchMemberships]);

  // Get the primary active membership (first active one)
  const activeMembership = memberships.find((m) => m.status === 'active') || null;

  return {
    memberships,
    activeMembership,
    loading,
    error,
    refetch: fetchMemberships,
  };
}
