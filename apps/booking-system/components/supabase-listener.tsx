'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authEventManager } from '@/lib/supabase/auth-events';
import { useAuthReconciliation } from '@/hooks/use-auth-reconciliation';

/**
 * Listens to Supabase auth state changes and refreshes the router so that
 * server components (like the navigation bar) re-render with the latest user.
 * Uses the centralized auth event manager to avoid duplicate subscriptions.
 * Includes auth state reconciliation to ensure client-server consistency.
 */
export function SupabaseAuthListener() {
  const router = useRouter();

  // Enable auth reconciliation with auto-refresh
  const { reconciliationResult } = useAuthReconciliation(undefined, {
    autoReconcile: true,
    autoRefresh: false, // We handle refresh manually
    reconcileInterval: 60000, // Check every minute
  });

  useEffect(() => {
    const unsubscribe = authEventManager.subscribe((authState) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('Supabase auth state changed:', {
          isAuthenticated: !!authState.session,
          userId: authState.session?.user?.id,
        });
      }

      // Refresh RSC payload so server components pick up new cookies/session
      router.refresh();
    });

    return unsubscribe;
  }, [router]);

  // Handle reconciliation results
  useEffect(() => {
    if (reconciliationResult && !reconciliationResult.isConsistent) {
      console.warn('Auth state inconsistency detected:', reconciliationResult.reason);

      // For critical mismatches, force a router refresh
      if (reconciliationResult.action === 'refresh') {
        router.refresh();
      }
    }
  }, [reconciliationResult, router]);

  return null;
}
