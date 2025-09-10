import type { User } from '@supabase/supabase-js';

/**
 * Profile data structure stored in user metadata
 */
export interface ProfileData {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string; // ISO date string (YYYY-MM-DD)
  phone?: string;
  preferences?: {
    email_notifications?: boolean;
    sms_notifications?: boolean;
  };
}

/**
 * Required profile fields for completion
 */
export interface RequiredProfileData {
  first_name: string;
  last_name: string;
  date_of_birth: string;
}

/**
 * Extract profile data from Supabase user metadata
 */
export function getProfileFromUser(user: User | null): ProfileData {
  if (!user?.user_metadata) {
    return {};
  }

  const metadata = user.user_metadata;

  return {
    first_name: metadata.first_name || '',
    last_name: metadata.last_name || '',
    date_of_birth: metadata.date_of_birth || '',
    phone: metadata.phone || '',
    preferences: {
      email_notifications: metadata.preferences?.email_notifications ?? true,
      sms_notifications: metadata.preferences?.sms_notifications ?? false,
    },
  };
}

/**
 * Create metadata object for updating user profile
 */
export function createProfileMetadata(profileData: Partial<ProfileData>): Record<string, string | undefined | object> {
  const metadata: Record<string, string | undefined | object> = {};

  if (profileData.first_name !== undefined) {
    metadata.first_name = profileData.first_name;
  }

  if (profileData.last_name !== undefined) {
    metadata.last_name = profileData.last_name;
  }

  if (profileData.date_of_birth !== undefined) {
    metadata.date_of_birth = profileData.date_of_birth;
  }

  if (profileData.phone !== undefined) {
    metadata.phone = profileData.phone;
  }

  if (profileData.preferences !== undefined) {
    metadata.preferences = {
      ...(typeof metadata.preferences === 'object' ? metadata.preferences : {}),
      ...profileData.preferences,
    };
  }

  return metadata;
}

/**
 * Check if profile has all required fields completed
 */
export function isProfileComplete(user: User | null): boolean {
  const profile = getProfileFromUser(user);

  return !!(profile.first_name && profile.last_name && profile.date_of_birth);
}

/**
 * Check if profile has all required fields completed (with explicit data)
 */
export function isProfileDataComplete(profileData: ProfileData): boolean {
  return !!(profileData.first_name && profileData.last_name && profileData.date_of_birth);
}

/**
 * Get missing required profile fields
 */
export function getMissingProfileFields(user: User | null): Array<keyof RequiredProfileData> {
  const profile = getProfileFromUser(user);
  const missing: Array<keyof RequiredProfileData> = [];

  if (!profile.first_name) missing.push('first_name');
  if (!profile.last_name) missing.push('last_name');
  if (!profile.date_of_birth) missing.push('date_of_birth');

  return missing;
}

/**
 * Get user's full name from profile data
 */
export function getFullName(user: User | null): string {
  const profile = getProfileFromUser(user);
  const firstName = profile.first_name?.trim() || '';
  const lastName = profile.last_name?.trim() || '';

  if (!firstName && !lastName) {
    return user?.email?.split('@')[0] || 'User';
  }

  return `${firstName} ${lastName}`.trim();
}

/**
 * Format date of birth for display
 */
export function formatDateOfBirth(dateString: string | undefined): string {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Validate date of birth (must be at least 18 years old)
 */
export function validateDateOfBirth(dateString: string): { valid: boolean; error?: string } {
  if (!dateString) {
    return { valid: false, error: 'Date of birth is required' };
  }

  try {
    const date = new Date(dateString);
    const today = new Date();

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return { valid: false, error: 'Invalid date format' };
    }

    // Check if date is in the future
    if (date > today) {
      return { valid: false, error: 'Date of birth cannot be in the future' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid date format' };
  }
}

/**
 * Validate profile data
 */
export function validateProfileData(data: Partial<ProfileData>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  // Validate first name
  if (data.first_name !== undefined) {
    if (!data.first_name.trim()) {
      errors.first_name = 'First name is required';
    } else if (data.first_name.trim().length < 2) {
      errors.first_name = 'First name must be at least 2 characters';
    } else if (data.first_name.trim().length > 50) {
      errors.first_name = 'First name must be less than 50 characters';
    }
  }

  // Validate last name
  if (data.last_name !== undefined) {
    if (!data.last_name.trim()) {
      errors.last_name = 'Last name is required';
    } else if (data.last_name.trim().length < 2) {
      errors.last_name = 'Last name must be at least 2 characters';
    } else if (data.last_name.trim().length > 50) {
      errors.last_name = 'Last name must be less than 50 characters';
    }
  }

  // Validate date of birth
  if (data.date_of_birth !== undefined) {
    const dobValidation = validateDateOfBirth(data.date_of_birth);
    if (!dobValidation.valid) {
      errors.date_of_birth = dobValidation.error || 'Invalid date of birth';
    }
  }

  // Validate phone (optional)
  if (data.phone !== undefined && data.phone.trim()) {
    const phoneRegex = /^[+]?[1-9][\d]{0,15}$/;
    if (!phoneRegex.test(data.phone.replace(/[\s\-()]/g, ''))) {
      errors.phone = 'Please enter a valid phone number';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
