// React hook for updating member profile

import { useCallback, useState } from 'react';
import type {
  LocalProfileOverrides,
  MomenceUserProfile,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from '@/lib/momence-oauth-types';

const LOCAL_STORAGE_KEY = 'pyre_profile_overrides';

/**
 * Get profile overrides from localStorage
 */
export function getLocalProfileOverrides(): LocalProfileOverrides | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as LocalProfileOverrides;
  } catch {
    return null;
  }
}

/**
 * Save profile overrides to localStorage
 */
function setLocalProfileOverrides(overrides: LocalProfileOverrides): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(overrides));
  } catch (error) {
    console.error('[useUpdateProfile] Failed to save to localStorage:', error);
  }
}

/**
 * Merge API profile with local overrides
 */
export function mergeProfileWithOverrides(profile: MomenceUserProfile): MomenceUserProfile {
  const overrides = getLocalProfileOverrides();
  if (!overrides) return profile;

  return {
    ...profile,
    phone: overrides.phone ?? profile.phone,
  };
}

interface UseUpdateProfileResult {
  updateProfile: (data: UpdateProfileRequest) => Promise<boolean>;
  loading: boolean;
  error: string | null;
  success: boolean;
}

export function useUpdateProfile(): UseUpdateProfileResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateProfile = useCallback(async (data: UpdateProfileRequest): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/member/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result: UpdateProfileResponse = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error || 'Failed to update profile');
        return false;
      }

      // If API returned useLocalStorage flag, save to localStorage
      if (result.useLocalStorage && data.phone !== undefined) {
        const currentOverrides = getLocalProfileOverrides();
        setLocalProfileOverrides({
          ...currentOverrides,
          phone: data.phone,
          updatedAt: Date.now(),
        });
      }

      setSuccess(true);
      return true;
    } catch (err) {
      console.error('[useUpdateProfile] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to update profile');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    updateProfile,
    loading,
    error,
    success,
  };
}
