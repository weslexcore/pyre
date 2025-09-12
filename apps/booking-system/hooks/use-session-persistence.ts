'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  sessionPersistenceValidator,
  type SessionValidationResult,
} from '@/lib/supabase/session-persistence-validator';
import { useAuthState } from './use-auth-state';

export interface SessionPersistenceState {
  validationResult: SessionValidationResult | null;
  isValidating: boolean;
  lastValidationTime: number;
  hasValidationError: boolean;
}

export function useSessionPersistence() {
  const [state, setState] = useState<SessionPersistenceState>({
    validationResult: null,
    isValidating: false,
    lastValidationTime: 0,
    hasValidationError: false,
  });

  const { session, isLoading } = useAuthState();

  const validateSession = useCallback(async () => {
    if (isLoading || !session) return;

    setState((prev) => ({ ...prev, isValidating: true }));

    try {
      const result = await sessionPersistenceValidator.validateSessionPersistence();

      setState({
        validationResult: result,
        isValidating: false,
        lastValidationTime: Date.now(),
        hasValidationError: !result.isValid,
      });
    } catch {
      setState((prev) => ({
        ...prev,
        isValidating: false,
        hasValidationError: true,
      }));
    }
  }, [session, isLoading]);

  const checkSessionHealth = useCallback(async () => {
    return sessionPersistenceValidator.checkSessionHealth();
  }, []);

  // Validate session when auth state changes
  useEffect(() => {
    if (!isLoading && session) {
      validateSession();
    }
  }, [session, isLoading, validateSession]);

  // Periodic validation check
  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionPersistenceValidator.shouldValidateSession()) {
        validateSession();
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [validateSession]);

  return {
    ...state,
    validateSession,
    checkSessionHealth,
    isValidationNeeded: sessionPersistenceValidator.shouldValidateSession(),
  };
}
