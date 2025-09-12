'use client';

import { useEffect, useState } from 'react';
import { authEventManager, type AuthState } from '@/lib/supabase/auth-events';

export function useAuthState() {
  const [authState, setAuthState] = useState<AuthState>(authEventManager.getCurrentState());

  useEffect(() => {
    const unsubscribe = authEventManager.subscribe(setAuthState);
    return unsubscribe;
  }, []);

  const isAuthenticated = !!authState.session;
  const user = authState.session?.user ?? null;

  return {
    ...authState,
    isAuthenticated,
    user,
  };
}
