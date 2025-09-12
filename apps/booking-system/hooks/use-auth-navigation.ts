'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { sessionValidator } from '@/lib/supabase/session-validator';
import { useAuthState } from './use-auth-state';

export interface NavigationOptions {
  requireAuth?: boolean;
  onValidationError?: (error: string) => void;
  onUnauthorized?: () => void;
}

export function useAuthNavigation() {
  const router = useRouter();
  const { isAuthenticated } = useAuthState();

  const navigateWithValidation = useCallback(
    async (href: string, options: NavigationOptions = {}): Promise<boolean> => {
      const { requireAuth = false, onValidationError, onUnauthorized } = options;

      try {
        // Validate session if required
        if (requireAuth) {
          const validation = await sessionValidator.validateSession({ requireAuth: true });

          if (!validation.isValid) {
            const error =
              validation.error instanceof Error
                ? validation.error.message
                : validation.error || 'Authentication required';

            if (onValidationError) {
              onValidationError(error);
            }

            if (onUnauthorized) {
              onUnauthorized();
            } else {
              // Default: redirect to login
              router.push('/auth/login');
            }

            return false;
          }
        }

        // Validation passed, navigate
        router.push(href);
        return true;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Navigation validation failed';

        if (onValidationError) {
          onValidationError(errorMessage);
        }

        return false;
      }
    },
    [router]
  );

  const replaceWithValidation = useCallback(
    async (href: string, options: NavigationOptions = {}): Promise<boolean> => {
      const { requireAuth = false, onValidationError, onUnauthorized } = options;

      try {
        if (requireAuth) {
          const validation = await sessionValidator.validateSession({ requireAuth: true });

          if (!validation.isValid) {
            const error =
              validation.error instanceof Error
                ? validation.error.message
                : validation.error || 'Authentication required';

            if (onValidationError) {
              onValidationError(error);
            }

            if (onUnauthorized) {
              onUnauthorized();
            } else {
              router.replace('/auth/login');
            }

            return false;
          }
        }

        router.replace(href);
        return true;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Navigation validation failed';

        if (onValidationError) {
          onValidationError(errorMessage);
        }

        return false;
      }
    },
    [router]
  );

  return {
    navigateWithValidation,
    replaceWithValidation,
    isAuthenticated,
  };
}
