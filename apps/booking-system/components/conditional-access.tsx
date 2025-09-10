'use client';

import type { ReactNode } from 'react';
import { useProfileCompletion } from '@/hooks/use-profile';
import { ROUTE_PROTECTION, type RouteProtectionLevel } from '@/lib/utils/route-protection';

interface ConditionalAccessProps {
  children: ReactNode;
  /**
   * The minimum protection level required to show the content
   */
  requireLevel: RouteProtectionLevel;
  /**
   * Content to show when requirements are not met
   */
  fallback?: ReactNode;
  /**
   * Whether to show a loading state while checking requirements
   */
  showLoading?: boolean;
}

/**
 * Conditionally render content based on user's authentication and profile status
 *
 * Usage:
 * ```tsx
 * <ConditionalAccess requireLevel={ROUTE_PROTECTION.PROFILE_COMPLETE}>
 *   <BookingButton />
 * </ConditionalAccess>
 * ```
 */
export function ConditionalAccess({
  children,
  requireLevel,
  fallback = null,
  showLoading = true,
}: ConditionalAccessProps) {
  const { user, isEmailConfirmed, isComplete, canAccessProtectedFeatures } = useProfileCompletion();

  // Show loading state if requested and user data is still loading
  if (showLoading && user === undefined) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded"></div>
      </div>
    );
  }

  // Check requirements based on protection level
  const meetsRequirements = (() => {
    switch (requireLevel) {
      case ROUTE_PROTECTION.PUBLIC:
        return true;

      case ROUTE_PROTECTION.AUTH_REQUIRED:
        return !!user;

      case ROUTE_PROTECTION.EMAIL_CONFIRMED:
        return !!user && isEmailConfirmed;

      case ROUTE_PROTECTION.PROFILE_COMPLETE:
        return !!user && isEmailConfirmed && isComplete;

      case ROUTE_PROTECTION.ADMIN_ONLY:
        return (
          !!user && isEmailConfirmed && isComplete && user?.user_metadata?.is_super_admin === true
        );

      default:
        return false;
    }
  })();

  return meetsRequirements ? <>{children}</> : <>{fallback}</>;
}

/**
 * Higher-order component version of ConditionalAccess
 */
export function withConditionalAccess<P extends object>(
  Component: React.ComponentType<P>,
  requireLevel: RouteProtectionLevel,
  fallback?: ReactNode
) {
  const WrappedComponent = (props: P) => {
    return (
      <ConditionalAccess requireLevel={requireLevel} fallback={fallback}>
        <Component {...props} />
      </ConditionalAccess>
    );
  };

  WrappedComponent.displayName = `withConditionalAccess(${Component.displayName || Component.name})`;

  return WrappedComponent;
}

/**
 * Hook to get the current user's access level for conditional logic
 */
export function useAccessLevel() {
  const { user, isEmailConfirmed, isComplete } = useProfileCompletion();

  const getAccessLevel = (): RouteProtectionLevel => {
    if (!user) {
      return ROUTE_PROTECTION.PUBLIC;
    }

    if (user.user_metadata?.is_super_admin === true && isEmailConfirmed && isComplete) {
      return ROUTE_PROTECTION.ADMIN_ONLY;
    }

    if (isEmailConfirmed && isComplete) {
      return ROUTE_PROTECTION.PROFILE_COMPLETE;
    }

    if (isEmailConfirmed) {
      return ROUTE_PROTECTION.EMAIL_CONFIRMED;
    }

    return ROUTE_PROTECTION.AUTH_REQUIRED;
  };

  const accessLevel = getAccessLevel();

  return {
    accessLevel,
    canAccess: (requiredLevel: RouteProtectionLevel) => {
      const levels = [
        ROUTE_PROTECTION.PUBLIC,
        ROUTE_PROTECTION.AUTH_REQUIRED,
        ROUTE_PROTECTION.EMAIL_CONFIRMED,
        ROUTE_PROTECTION.PROFILE_COMPLETE,
        ROUTE_PROTECTION.ADMIN_ONLY,
      ];

      const userLevelIndex = levels.indexOf(accessLevel);
      const requiredLevelIndex = levels.indexOf(requiredLevel);

      return userLevelIndex >= requiredLevelIndex;
    },
    user,
    isEmailConfirmed,
    isComplete,
  };
}
