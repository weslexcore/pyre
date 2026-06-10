// React hook for fetching member credits
// Delegates to shared MemberDataContext

import { useMemberData } from '@/hooks/useMemberData';
import type { MemberCredits } from '@/lib/momence-member-types';

interface UseMemberCreditsResult {
  credits: MemberCredits | null;
  hasCredits: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMemberCredits(): UseMemberCreditsResult {
  const { credits, hasCredits, loading, error, refetch } = useMemberData();
  return { credits, hasCredits, loading, error, refetch };
}
