'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { sessionValidator, type ValidationResult } from '@/lib/supabase/session-validator';
import { useAuthState } from './use-auth-state';

export interface SessionValidationState {
  result: ValidationResult | null;
  isValidating: boolean;
  lastValidationTime: number;
  validationCount: number;
  error: Error | null;
}

export interface UseSessionValidationOptions {
  autoValidate?: boolean;
  validationInterval?: number;
  requireAuth?: boolean;
  cacheKey?: string;
  onValidationComplete?: (result: ValidationResult) => void;
  onValidationError?: (error: Error) => void;
}

export function useSessionValidation(options: UseSessionValidationOptions = {}) {
  const {
    autoValidate = false,
    validationInterval = 60000, // 1 minute
    requireAuth = false,
    cacheKey = 'default',
    onValidationComplete,
    onValidationError,
  } = options;

  const { session, isLoading } = useAuthState();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [state, setState] = useState<SessionValidationState>({
    result: null,
    isValidating: false,
    lastValidationTime: 0,
    validationCount: 0,
    error: null,
  });

  const validate = useCallback(
    async (forceRefresh = false): Promise<ValidationResult> => {
      setState((prev) => ({
        ...prev,
        isValidating: true,
        error: null,
      }));

      try {
        const result = await sessionValidator.validateSession({
          forceRefresh,
          requireAuth,
          cacheKey,
        });

        setState((prev) => ({
          ...prev,
          result,
          isValidating: false,
          lastValidationTime: Date.now(),
          validationCount: prev.validationCount + 1,
          error: result.error instanceof Error ? result.error : null,
        }));

        // Call completion callback
        if (onValidationComplete) {
          onValidationComplete(result);
        }

        // Call error callback if validation failed
        if (!result.isValid && result.error && onValidationError) {
          onValidationError(
            result.error instanceof Error ? result.error : new Error(String(result.error))
          );
        }

        return result;
      } catch (error) {
        const validationError = error instanceof Error ? error : new Error(String(error));

        setState((prev) => ({
          ...prev,
          isValidating: false,
          error: validationError,
          lastValidationTime: Date.now(),
          validationCount: prev.validationCount + 1,
        }));

        if (onValidationError) {
          onValidationError(validationError);
        }

        throw validationError;
      }
    },
    [requireAuth, cacheKey, onValidationComplete, onValidationError]
  );

  const validateIfNeeded = useCallback(async (): Promise<ValidationResult | null> => {
    // Don't validate if already validating
    if (state.isValidating) return null;

    // Don't validate if auth is still loading
    if (isLoading) return null;

    // Check if validation is needed based on time interval
    const timeSinceLastValidation = Date.now() - state.lastValidationTime;
    if (timeSinceLastValidation < validationInterval) return null;

    return validate();
  }, [state.isValidating, state.lastValidationTime, isLoading, validationInterval, validate]);

  const startAutoValidation = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      validateIfNeeded().catch(console.warn);
    }, validationInterval);
  }, [validateIfNeeded, validationInterval]);

  const stopAutoValidation = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      result: null,
      isValidating: false,
      lastValidationTime: 0,
      validationCount: 0,
      error: null,
    });
    sessionValidator.clearCache();
  }, []);

  // Auto-validation effect
  useEffect(() => {
    if (autoValidate && !isLoading) {
      startAutoValidation();

      // Initial validation
      validateIfNeeded().catch(console.warn);
    }

    return () => {
      stopAutoValidation();
    };
  }, [autoValidate, isLoading, startAutoValidation, stopAutoValidation, validateIfNeeded]);

  // Validate when session changes (if auto-validate is enabled)
  useEffect(() => {
    if (autoValidate && !isLoading && session) {
      validate().catch(console.warn);
    }
  }, [session, autoValidate, isLoading, validate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoValidation();
    };
  }, [stopAutoValidation]);

  return {
    ...state,
    validate,
    validateIfNeeded,
    startAutoValidation,
    stopAutoValidation,
    reset,
    isValid: state.result?.isValid ?? null,
    retryCount: state.result?.retryCount ?? 0,
    validationType: state.result?.validationType ?? null,
    sessionValidatorStats: {
      activeValidations: sessionValidator.getActiveValidations(),
      cacheStats: sessionValidator.getCacheStats(),
    },
  };
}
