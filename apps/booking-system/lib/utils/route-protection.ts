import { redirect } from 'next/navigation';
import { validateUserRouteAccess, getCurrentUserProfileCompletionStatus } from '@/lib/supabase/queries';

/**
 * Server component utility to protect routes with automatic redirects
 * Use this in page components that require authentication/profile completion
 */
export async function requireAuth(routePath: string = '/protected') {
  const access = await validateUserRouteAccess(routePath);
  
  if (!access.canAccess && access.redirectTo) {
    redirect(access.redirectTo);
  }
  
  return access;
}

/**
 * Server component utility to require email confirmation
 * Redirects to unauthorized page if email is not confirmed
 */
export async function requireEmailConfirmation() {
  const status = await getCurrentUserProfileCompletionStatus();
  
  if (!status.isAuthenticated) {
    redirect('/auth/login');
  }
  
  if (!status.isEmailConfirmed) {
    redirect('/unauthorized?reason=email_confirmation_required');
  }
  
  return status;
}

/**
 * Server component utility to require profile completion
 * Redirects to complete-profile page if profile is incomplete
 */
export async function requireProfileCompletion() {
  const status = await getCurrentUserProfileCompletionStatus();
  
  if (!status.isAuthenticated) {
    redirect('/auth/login');
  }
  
  if (!status.isEmailConfirmed) {
    redirect('/unauthorized?reason=email_confirmation_required');
  }
  
  if (!status.isProfileComplete) {
    redirect('/complete-profile');
  }
  
  return status;
}

/**
 * Server component utility to require admin access
 * Redirects to unauthorized page if user is not an admin
 */
export async function requireAdmin() {
  const status = await requireProfileCompletion();
  const access = await validateUserRouteAccess('/admin');
  
  if (!access.canAccess && access.redirectTo) {
    redirect(access.redirectTo);
  }
  
  return { ...status, access };
}

/**
 * Server component utility for optional authentication
 * Returns user status without redirecting, useful for pages that work with/without auth
 */
export async function getOptionalAuth() {
  try {
    const status = await getCurrentUserProfileCompletionStatus();
    return status;
  } catch {
    return {
      isAuthenticated: false,
      isEmailConfirmed: false,
      isProfileComplete: false,
      canAccessProtectedFeatures: false,
      nextStep: 'login' as const,
      missingFields: ['first_name', 'last_name', 'date_of_birth'],
    };
  }
}

/**
 * Route protection configuration for different page types
 */
export const ROUTE_PROTECTION = {
  PUBLIC: 'public',
  AUTH_REQUIRED: 'auth_required',
  EMAIL_CONFIRMED: 'email_confirmed', 
  PROFILE_COMPLETE: 'profile_complete',
  ADMIN_ONLY: 'admin_only',
} as const;

export type RouteProtectionLevel = typeof ROUTE_PROTECTION[keyof typeof ROUTE_PROTECTION];

/**
 * Route configuration mapping paths to protection levels
 */
export const ROUTE_PROTECTION_CONFIG: Record<string, RouteProtectionLevel> = {
  // Public routes - no protection required
  '/': ROUTE_PROTECTION.PUBLIC,
  '/schedule': ROUTE_PROTECTION.PUBLIC,
  '/auth': ROUTE_PROTECTION.PUBLIC,
  '/unauthorized': ROUTE_PROTECTION.PUBLIC,

  // Routes requiring only authentication
  '/dashboard': ROUTE_PROTECTION.AUTH_REQUIRED,

  // Routes requiring email confirmation but not necessarily profile completion
  '/profile': ROUTE_PROTECTION.EMAIL_CONFIRMED,
  '/settings': ROUTE_PROTECTION.EMAIL_CONFIRMED,
  '/notifications': ROUTE_PROTECTION.EMAIL_CONFIRMED,

  // Routes requiring full profile completion
  '/account': ROUTE_PROTECTION.PROFILE_COMPLETE,
  '/booking': ROUTE_PROTECTION.PROFILE_COMPLETE,
  '/protected': ROUTE_PROTECTION.PROFILE_COMPLETE,
  '/reservations': ROUTE_PROTECTION.PROFILE_COMPLETE,
  '/history': ROUTE_PROTECTION.PROFILE_COMPLETE,

  // Admin-only routes
  '/admin': ROUTE_PROTECTION.ADMIN_ONLY,

  // Special case: profile completion page requires email confirmation but not profile completion
  '/complete-profile': ROUTE_PROTECTION.EMAIL_CONFIRMED,
};

/**
 * Get the protection level required for a given route
 */
export function getRouteProtectionLevel(pathname: string): RouteProtectionLevel {
  // Check for exact matches first
  if (ROUTE_PROTECTION_CONFIG[pathname]) {
    return ROUTE_PROTECTION_CONFIG[pathname];
  }

  // Check for prefix matches (e.g., /admin/locations matches /admin)
  for (const [routePath, level] of Object.entries(ROUTE_PROTECTION_CONFIG)) {
    if (pathname.startsWith(routePath + '/') || pathname.startsWith(routePath)) {
      return level;
    }
  }

  // Default to authentication required for unknown routes
  return ROUTE_PROTECTION.AUTH_REQUIRED;
}

/**
 * Apply route protection based on protection level
 */
export async function applyRouteProtection(
  level: RouteProtectionLevel,
  routePath?: string
) {
  switch (level) {
    case ROUTE_PROTECTION.PUBLIC:
      return await getOptionalAuth();
    
    case ROUTE_PROTECTION.AUTH_REQUIRED:
      return await requireAuth(routePath);
    
    case ROUTE_PROTECTION.EMAIL_CONFIRMED:
      return await requireEmailConfirmation();
    
    case ROUTE_PROTECTION.PROFILE_COMPLETE:
      return await requireProfileCompletion();
    
    case ROUTE_PROTECTION.ADMIN_ONLY:
      return await requireAdmin();
    
    default:
      return await getOptionalAuth();
  }
}

/**
 * Apply route protection automatically based on the route path
 * Uses the ROUTE_PROTECTION_CONFIG to determine the appropriate protection level
 */
export async function protectRoute(pathname: string) {
  const protectionLevel = getRouteProtectionLevel(pathname);
  return await applyRouteProtection(protectionLevel, pathname);
}

/**
 * Check if a route allows partial access (e.g., for conditional feature display)
 */
export function getRouteAccessInfo(pathname: string) {
  const protectionLevel = getRouteProtectionLevel(pathname);
  
  return {
    protectionLevel,
    isPublic: protectionLevel === ROUTE_PROTECTION.PUBLIC,
    requiresAuth: protectionLevel !== ROUTE_PROTECTION.PUBLIC,
    requiresEmailConfirmation: [
      ROUTE_PROTECTION.EMAIL_CONFIRMED,
      ROUTE_PROTECTION.PROFILE_COMPLETE,
      ROUTE_PROTECTION.ADMIN_ONLY,
    ].includes(protectionLevel),
    requiresProfileCompletion: [
      ROUTE_PROTECTION.PROFILE_COMPLETE,
      ROUTE_PROTECTION.ADMIN_ONLY,
    ].includes(protectionLevel),
    requiresAdminAccess: protectionLevel === ROUTE_PROTECTION.ADMIN_ONLY,
  };
}