'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser, updateUserProfile } from '@/lib/supabase/client-queries';
import {
  getProfileFromUser,
  isProfileComplete,
  getMissingProfileFields,
  validateProfileData,
  getFullName,
  type ProfileData,
} from '@/lib/utils/profile';
import { toast } from 'sonner';

/**
 * Hook for managing user profile data and validation
 */
export function useProfile() {
  const queryClient = useQueryClient();

  // Get current user and profile data
  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
  } = useQuery({
    queryKey: ['user'],
    queryFn: getCurrentUser,
    retry: false,
  });

  const profile = getProfileFromUser(user ?? null);
  const isComplete = isProfileComplete(user ?? null);
  const missingFields = getMissingProfileFields(user ?? null);
  const isEmailConfirmed = !!user?.email_confirmed_at;
  const fullName = getFullName(user ?? null);

  // Update profile mutation
  const updateProfile = useMutation({
    mutationFn: updateUserProfile,
    onSuccess: (data) => {
      // Update the user query cache with new data
      queryClient.setQueryData(['user'], data.user);
      toast.success('Profile updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update profile');
    },
  });

  // Validate profile data
  const validateProfile = (data: Partial<ProfileData>) => {
    return validateProfileData(data);
  };

  // Check if specific fields are missing
  const isFieldMissing = (field: keyof ProfileData) => {
    return (missingFields as Array<keyof ProfileData>).includes(field);
  };

  // Get profile completion percentage
  const getCompletionPercentage = () => {
    const requiredFields = ['first_name', 'last_name', 'date_of_birth'];
    const completedFields = requiredFields.filter(
      (field) => profile[field as keyof ProfileData]
    ).length;
    return Math.round((completedFields / requiredFields.length) * 100);
  };

  return {
    // User data
    user,
    profile,
    fullName,
    isLoadingUser,
    userError,
    refetchUser,

    // Profile completion status
    isComplete,
    isEmailConfirmed,
    missingFields,
    isFieldMissing,
    getCompletionPercentage,

    // Validation
    validateProfile,

    // Mutations
    updateProfile: {
      mutate: updateProfile.mutate,
      mutateAsync: updateProfile.mutateAsync,
      isPending: updateProfile.isPending,
      error: updateProfile.error,
      isSuccess: updateProfile.isSuccess,
    },
  };
}

/**
 * Hook specifically for checking profile completion requirements
 */
export function useProfileCompletion() {
  const { user, isComplete, missingFields, isEmailConfirmed } = useProfile();

  // Check if user can access protected features
  const canAccessProtectedFeatures = isEmailConfirmed && isComplete;

  // Get the next required step for the user
  const getNextStep = () => {
    if (!user) return 'login';
    if (!isEmailConfirmed) return 'confirm_email';
    if (!isComplete) return 'complete_profile';
    return 'all_complete';
  };

  // Get user-friendly message for current status
  const getStatusMessage = () => {
    const nextStep = getNextStep();

    switch (nextStep) {
      case 'login':
        return 'Please sign in to continue';
      case 'confirm_email':
        return 'Please confirm your email address to continue';
      case 'complete_profile':
        return `Please complete your profile. Missing: ${missingFields.join(', ').replace(/_/g, ' ')}`;
      case 'all_complete':
        return 'Profile complete';
      default:
        return '';
    }
  };

  return {
    user,
    isEmailConfirmed,
    isComplete,
    canAccessProtectedFeatures,
    missingFields,
    nextStep: getNextStep(),
    statusMessage: getStatusMessage(),
  };
}
