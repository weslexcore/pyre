// React hook for fetching member memberships
// Delegates to shared MemberDataContext

import type { MemberMembership } from '@/lib/momence-member-types';
import { useMemberData } from '@/hooks/useMemberData';

interface UseMemberMembershipsResult {
  memberships: MemberMembership[];
  activeMembership: MemberMembership | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMemberMemberships(): UseMemberMembershipsResult {
  const { memberships, activeMembership, loading, error, refetch } = useMemberData();
  return { memberships, activeMembership, loading, error, refetch };
}
