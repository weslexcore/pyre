'use client';

import { useEffect, type ReactNode } from 'react';
import { ProfileCompletionModal, useProfileCompletionModal } from './profile-completion-modal';
import { useProfileCompletion } from '@/hooks/use-profile';

interface ProfileCompletionGuardProps {
  children: ReactNode;
  /**
   * Whether to require full profile completion (email + profile)
   * or just email confirmation
   */
  requireFullCompletion?: boolean;
  /**
   * Whether users can dismiss the modal and continue
   * Default: true for non-critical features, false for critical ones
   */
  dismissible?: boolean;
  /**
   * Custom message to show in the modal
   */
  blockingMessage?: string;
  /**
   * Callback when user completes requirements
   */
  onRequirementsMet?: () => void;
}

/**
 * A wrapper component that automatically shows the profile completion modal
 * when users try to access features requiring profile completion.
 *
 * Usage:
 * ```tsx
 * <ProfileCompletionGuard requireFullCompletion>
 *   <BookingButton />
 * </ProfileCompletionGuard>
 * ```
 */
export function ProfileCompletionGuard({
  children,
  requireFullCompletion = true,
  dismissible = true,
  blockingMessage,
  onRequirementsMet,
}: ProfileCompletionGuardProps) {
  const { isEmailConfirmed, canAccessProtectedFeatures } = useProfileCompletion();
  const { isOpen, showModal, closeModal } = useProfileCompletionModal();

  // Determine if requirements are met based on the requirement level
  const requirementsMet = requireFullCompletion ? canAccessProtectedFeatures : isEmailConfirmed;

  useEffect(() => {
    if (requirementsMet && onRequirementsMet) {
      onRequirementsMet();
    }
  }, [requirementsMet, onRequirementsMet]);

  // Automatically open/close the modal based on requirements
  useEffect(() => {
    if (!requirementsMet) {
      showModal();
    } else {
      closeModal();
    }
  }, [requirementsMet, showModal, closeModal]);

  // For server-side rendered content, always show children initially
  // The modal will appear on client-side hydration if needed
  return (
    <>
      {children}
      <ProfileCompletionModal
        open={isOpen}
        onOpenChange={closeModal}
        dismissible={dismissible}
        description={
          blockingMessage || 'Please complete the required steps to access this feature.'
        }
        onProfileComplete={onRequirementsMet}
      />
    </>
  );
}

/**
 * A higher-order component version of ProfileCompletionGuard
 */
export function withProfileCompletionGuard<P extends object>(
  Component: React.ComponentType<P>,
  options: {
    requireFullCompletion?: boolean;
    dismissible?: boolean;
    blockingMessage?: string;
  } = {}
) {
  const WrappedComponent = (props: P) => {
    return (
      <ProfileCompletionGuard {...options}>
        <Component {...props} />
      </ProfileCompletionGuard>
    );
  };

  WrappedComponent.displayName = `withProfileCompletionGuard(${Component.displayName || Component.name})`;

  return WrappedComponent;
}
