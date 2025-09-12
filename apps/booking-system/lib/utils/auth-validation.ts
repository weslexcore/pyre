'use client';

import { authEventManager } from '@/lib/supabase/auth-events';
import type { Session } from '@supabase/supabase-js';

export interface AuthValidationOptions {
  requireAuth?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface SessionValidationResult {
  isValid: boolean;
  session: Session | null;
  error?: string;
}

export class AuthValidationError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AuthValidationError';
  }
}

export async function validateSession(
  options: AuthValidationOptions = {}
): Promise<SessionValidationResult> {
  const { requireAuth = true, maxRetries = 3, retryDelay = 500, timeout = 5000 } = options;

  return new Promise((resolve) => {
    let retryCount = 0;

    const attemptValidation = () => {
      const currentState = authEventManager.getCurrentState();

      // If still loading and we have retries left, wait and retry
      if (currentState.isLoading && retryCount < maxRetries) {
        retryCount++;
        setTimeout(attemptValidation, retryDelay);
        return;
      }

      // Clear timeout if validation completes
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Check for errors
      if (currentState.error) {
        resolve({
          isValid: false,
          session: null,
          error: currentState.error,
        });
        return;
      }

      // Check authentication requirement
      if (requireAuth && !currentState.session) {
        resolve({
          isValid: false,
          session: null,
          error: 'Authentication required',
        });
        return;
      }

      // Session is valid
      resolve({
        isValid: true,
        session: currentState.session,
      });
    };

    // Set timeout for validation
    const timeoutId = setTimeout(() => {
      resolve({
        isValid: false,
        session: null,
        error: 'Session validation timeout',
      });
    }, timeout);

    // Start validation
    attemptValidation();
  });
}

export async function ensureAuthenticated(): Promise<Session> {
  const result = await validateSession({ requireAuth: true });

  if (!result.isValid) {
    throw new AuthValidationError(result.error || 'Authentication required', 'AUTH_REQUIRED');
  }

  return result.session!;
}

export async function waitForAuthState(
  maxWaitTime: number = 3000
): Promise<SessionValidationResult> {
  return validateSession({
    requireAuth: false,
    timeout: maxWaitTime,
    maxRetries: 6,
    retryDelay: 250,
  });
}
