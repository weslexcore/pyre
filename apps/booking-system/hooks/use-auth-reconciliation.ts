'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  authReconciliation,
  type ServerAuthState,
  type AuthReconciliationResult,
} from '@/lib/supabase/auth-reconciliation';
import { useAuthState } from './use-auth-state';

export interface AuthReconciliationHookOptions {
  autoReconcile?: boolean;
  autoRefresh?: boolean;
  reconcileInterval?: number;
}

export function useAuthReconciliation(
  serverState?: ServerAuthState,
  options: AuthReconciliationHookOptions = {}
) {
  const {
    autoReconcile = true,
    autoRefresh = true,
    reconcileInterval = 30000, // 30 seconds
  } = options;

  const [reconciliationResult, setReconciliationResult] = useState<AuthReconciliationResult | null>(
    null
  );
  const [isReconciling, setIsReconciling] = useState(false);
  const { isLoading } = useAuthState();
  const router = useRouter();

  const performReconciliation = useCallback(async () => {
    if (isLoading) return;

    setIsReconciling(true);
    try {
      const result = await authReconciliation.reconcileAuthState(serverState);
      setReconciliationResult(result);

      // Auto-handle reconciliation actions
      if (autoRefresh && result.action === 'refresh') {
        await authReconciliation.forceRefresh();
      } else if (autoReconcile && result.action === 'sync' && serverState) {
        const syncSuccess = await authReconciliation.syncClientWithServer(serverState);
        if (!syncSuccess && autoRefresh) {
          router.refresh();
        }
      }
    } catch (error) {
      console.warn('Reconciliation failed:', error);
    } finally {
      setIsReconciling(false);
    }
  }, [serverState, autoReconcile, autoRefresh, isLoading, router]);

  // Initial reconciliation when component mounts or auth state changes
  useEffect(() => {
    if (!isLoading) {
      performReconciliation();
    }
  }, [performReconciliation, isLoading]);

  // Periodic reconciliation
  useEffect(() => {
    if (reconcileInterval > 0) {
      const interval = setInterval(() => {
        if (!isLoading && !isReconciling) {
          performReconciliation();
        }
      }, reconcileInterval);

      return () => clearInterval(interval);
    }
  }, [reconcileInterval, performReconciliation, isLoading, isReconciling]);

  // Handle session changes
  useEffect(() => {
    if (!isLoading && reconciliationResult && !reconciliationResult.isConsistent) {
      // Session changed, re-reconcile
      performReconciliation();
    }
  }, [performReconciliation, isLoading, reconciliationResult]);

  return {
    reconciliationResult,
    isReconciling,
    performReconciliation,
    forceRefresh: authReconciliation.forceRefresh,
  };
}
