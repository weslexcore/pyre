'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  browserCompatibilityTester,
  type BrowserCompatibilityReport,
} from '@/lib/supabase/browser-compatibility-tester';

export interface BrowserCompatibilityState {
  report: BrowserCompatibilityReport | null;
  isLoading: boolean;
  error: string | null;
}

export function useBrowserCompatibility(runOnMount = false) {
  const [state, setState] = useState<BrowserCompatibilityState>({
    report: null,
    isLoading: false,
    error: null,
  });

  const runCompatibilityTests = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const report = await browserCompatibilityTester.runCompatibilityTests();
      setState({
        report,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState({
        report: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Compatibility test failed',
      });
    }
  }, []);

  useEffect(() => {
    if (runOnMount && typeof window !== 'undefined') {
      runCompatibilityTests();
    }
  }, [runOnMount, runCompatibilityTests]);

  return {
    ...state,
    runCompatibilityTests,
  };
}
