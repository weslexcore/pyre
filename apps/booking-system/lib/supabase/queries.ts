import { createClient } from './server';
import type {
  Location,
  Offering,
  Booking,
  InsertLocation,
  UpdateLocation,
  InsertOffering,
  UpdateOffering,
  InsertBooking,
  UpdateBooking,
} from '../database.types';
import {
  isProfileComplete,
  getProfileFromUser,
  getMissingProfileFields,
  getFullName,
} from '../utils/profile';

// Location queries
export async function getLocations(activeOnly: boolean = true) {
  const supabase = await createClient();

  let query = supabase.from('locations').select('*');

  if (activeOnly) {
    query = query.eq('active', true);
  }

  const { data, error } = await query.order('name');

  if (error) throw error;
  return data as Location[];
}

export async function getLocationById(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase.from('locations').select('*').eq('id', id).single();

  if (error) throw error;
  return data as Location;
}

export async function createLocation(location: InsertLocation) {
  const supabase = await createClient();

  const { data, error } = await supabase.from('locations').insert(location).select().single();

  if (error) throw error;
  return data as Location;
}

export async function updateLocation(id: string, updates: UpdateLocation) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('locations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Location;
}

export async function deleteLocation(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('locations').delete().eq('id', id);

  if (error) throw error;
}

// Offering queries
export async function getOfferings(filters?: {
  dateFrom?: string;
  dateTo?: string;
  locationId?: string;
  sessionType?: string;
  includePast?: boolean; // Admin option to include past sessions
}) {
  const supabase = await createClient();

  let query = supabase.from('offerings').select(`
      *,
      location:locations(*)
    `);

  // Filter out past sessions unless explicitly requested (for admin use)
  if (!filters?.includePast) {
    const currentDate = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5); // HH:MM format

    // Filter: (date > today) OR (date = today AND time > current_time)
    query = query.or(`date.gt.${currentDate},and(date.eq.${currentDate},time.gt.${currentTime})`);
  }

  if (filters?.dateFrom) {
    query = query.gte('date', filters.dateFrom);
  }

  if (filters?.dateTo) {
    query = query.lte('date', filters.dateTo);
  }

  if (filters?.locationId) {
    query = query.eq('location_id', filters.locationId);
  }

  if (filters?.sessionType) {
    query = query.eq('session_type', filters.sessionType);
  }

  const { data, error } = await query.order('date').order('time');

  if (error) throw error;
  return data as Offering[];
}

export async function getOfferingById(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('offerings')
    .select(`
      *,
      location:locations(*)
    `)
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as Offering;
}

export async function createOffering(offering: InsertOffering) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('offerings')
    .insert(offering)
    .select(`
      *,
      location:locations(*)
    `)
    .single();

  if (error) throw error;
  return data as Offering;
}

export async function updateOffering(id: string, updates: UpdateOffering) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('offerings')
    .update(updates)
    .eq('id', id)
    .select(`
      *,
      location:locations(*)
    `)
    .single();

  if (error) throw error;
  return data as Offering;
}

export async function deleteOffering(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('offerings').delete().eq('id', id);

  if (error) throw error;
}

// Booking queries
export async function getUserBookings(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      *,
      offering:offerings(
        *,
        location:locations(*)
      )
    `)
    .eq('user_id', userId)
    .order('booking_date', { ascending: false });

  if (error) throw error;
  return data as Booking[];
}

export async function getOfferingBookings(offeringId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('offering_id', offeringId)
    .eq('status', 'confirmed');

  if (error) throw error;
  return data as Booking[];
}

export async function createBooking(booking: InsertBooking) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bookings')
    .insert(booking)
    .select(`
      *,
      offering:offerings(
        *,
        location:locations(*)
      )
    `)
    .single();

  if (error) throw error;
  return data as Booking;
}

export async function updateBooking(id: string, updates: UpdateBooking) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', id)
    .select(`
      *,
      offering:offerings(
        *,
        location:locations(*)
      )
    `)
    .single();

  if (error) throw error;
  return data as Booking;
}

export async function deleteBooking(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('bookings').delete().eq('id', id);

  if (error) throw error;
}

// Helper function to check if user already has booking for offering
export async function getUserBookingForOffering(userId: string, offeringId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_id', userId)
    .eq('offering_id', offeringId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 is "not found"
    throw error;
  }

  return data as Booking | null;
}

// User profile queries for server-side use

/**
 * Get current authenticated user (server-side)
 */
export async function getCurrentUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  return user;
}

/**
 * Check if current user's profile is complete (server-side)
 */
export async function isCurrentUserProfileComplete(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return isProfileComplete(user);
  } catch {
    return false;
  }
}

/**
 * Check if current user's email is confirmed (server-side)
 */
export async function isCurrentUserEmailConfirmed(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return !!user?.email_confirmed_at;
  } catch {
    return false;
  }
}

/**
 * Get current user's profile data (server-side)
 */
export async function getCurrentUserProfile() {
  const user = await getCurrentUser();
  return getProfileFromUser(user);
}

/**
 * Check if current user is admin (server-side)
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return user?.user_metadata?.is_super_admin === true;
  } catch {
    return false;
  }
}

/**
 * Get current user's missing profile fields (server-side)
 */
export async function getCurrentUserMissingFields() {
  try {
    const user = await getCurrentUser();
    return getMissingProfileFields(user);
  } catch {
    return ['first_name', 'last_name', 'date_of_birth']; // Return all required fields if error
  }
}

/**
 * Check if current user can access protected features (server-side)
 */
export async function canCurrentUserAccessProtectedFeatures(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    const isEmailConfirmed = !!user?.email_confirmed_at;
    const profileComplete = isProfileComplete(user);
    return isEmailConfirmed && profileComplete;
  } catch {
    return false;
  }
}

/**
 * Get current user's profile completion status (server-side)
 */
export async function getCurrentUserProfileCompletionStatus() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return {
        isAuthenticated: false,
        isEmailConfirmed: false,
        isProfileComplete: false,
        canAccessProtectedFeatures: false,
        nextStep: 'login' as const,
        missingFields: ['first_name', 'last_name', 'date_of_birth'],
      };
    }

    const isEmailConfirmed = !!user.email_confirmed_at;
    const isComplete = isProfileComplete(user);
    const missingFields = getMissingProfileFields(user);
    const canAccessProtectedFeatures = isEmailConfirmed && isComplete;

    let nextStep: 'confirm_email' | 'complete_profile' | 'all_complete';
    if (!isEmailConfirmed) {
      nextStep = 'confirm_email';
    } else if (!isComplete) {
      nextStep = 'complete_profile';
    } else {
      nextStep = 'all_complete';
    }

    return {
      isAuthenticated: true,
      isEmailConfirmed,
      isProfileComplete: isComplete,
      canAccessProtectedFeatures,
      nextStep,
      missingFields,
      profile: getProfileFromUser(user),
      fullName: getFullName(user),
    };
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
 * Validate user access to specific route (server-side)
 * Returns true if user can access the route, false otherwise
 */
export async function validateUserRouteAccess(routePath: string): Promise<{
  canAccess: boolean;
  redirectTo?: string;
  reason?: string;
}> {
  try {
    const status = await getCurrentUserProfileCompletionStatus();

    // Public routes - always accessible
    const publicPaths = ['/', '/schedule', '/auth', '/unauthorized'];
    const isPublicPath = publicPaths.some(
      (path) => routePath === path || routePath.startsWith(path + '/')
    );

    if (isPublicPath) {
      return { canAccess: true };
    }

    // Require authentication for all non-public routes
    if (!status.isAuthenticated) {
      return {
        canAccess: false,
        redirectTo: '/auth/login',
        reason: 'authentication_required',
      };
    }

    // Routes that require email confirmation and profile completion
    const protectedPaths = ['/account', '/protected', '/admin', '/booking'];
    const requiresFullCompletion = protectedPaths.some((path) => routePath.startsWith(path));

    if (requiresFullCompletion) {
      if (!status.isEmailConfirmed) {
        return {
          canAccess: false,
          redirectTo: '/unauthorized?reason=email_confirmation_required',
          reason: 'email_confirmation_required',
        };
      }

      if (!status.isProfileComplete) {
        return {
          canAccess: false,
          redirectTo: '/complete-profile',
          reason: 'profile_completion_required',
        };
      }
    }

    // Admin routes require admin privileges
    if (routePath.startsWith('/admin')) {
      const isAdmin = await isCurrentUserAdmin();
      if (!isAdmin) {
        return {
          canAccess: false,
          redirectTo: '/unauthorized',
          reason: 'admin_required',
        };
      }
    }

    return { canAccess: true };
  } catch {
    return {
      canAccess: false,
      redirectTo: '/auth/login',
      reason: 'error',
    };
  }
}
