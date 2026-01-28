// MemberDataProvider component
// Wraps children with shared member data context (single API call)

import type { ReactNode } from 'react';
import { MemberDataContext, useMemberDataFetcher } from '@/hooks/useMemberData';

export function MemberDataProvider({ children }: { children: ReactNode }) {
  const data = useMemberDataFetcher();
  return <MemberDataContext.Provider value={data}>{children}</MemberDataContext.Provider>;
}
