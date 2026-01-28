// Shared member data context
// Single fetch for memberships + credits, shared across components

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { MemberMembership, MemberCredits } from '@/lib/momence-member-types';

export interface MemberDataResult {
  memberships: MemberMembership[];
  activeMembership: MemberMembership | null;
  credits: MemberCredits | null;
  hasCredits: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const defaultValue: MemberDataResult = {
  memberships: [],
  activeMembership: null,
  credits: null,
  hasCredits: false,
  loading: true,
  error: null,
  refetch: async () => {},
};

export const MemberDataContext = createContext<MemberDataResult>(defaultValue);

export function useMemberDataFetcher(): MemberDataResult {
  const [memberships, setMemberships] = useState<MemberMembership[]>([]);
  const [credits, setCredits] = useState<MemberCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/member/memberships');

      if (response.status === 401) {
        setError('not_authenticated');
        setMemberships([]);
        setCredits(null);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setMemberships(data.memberships || []);
      setCredits(data.credits ?? null);
    } catch (err) {
      console.error('[useMemberData] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch member data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const activeMembership = memberships.find((m) => m.status === 'active') || null;
  const hasCredits = credits !== null && (credits.unlimited || credits.available > 0);

  return {
    memberships,
    activeMembership,
    credits,
    hasCredits,
    loading,
    error,
    refetch: fetchData,
  };
}

export function useMemberData(): MemberDataResult {
  return useContext(MemberDataContext);
}
