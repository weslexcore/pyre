'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useProfileCompletion } from '@/hooks/use-profile';
import { User, Mail, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface ProfileCompletionModalProps {
  /**
   * Whether the modal is open
   */
  open: boolean;
  /**
   * Callback when modal should be closed
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Whether the modal can be dismissed (closed without completing profile)
   * Default: true
   */
  dismissible?: boolean;
  /**
   * Custom title for the modal
   */
  title?: string;
  /**
   * Custom description for the modal
   */
  description?: string;
  /**
   * Action to take after profile completion
   * Default: close modal
   */
  onProfileComplete?: () => void;
  /**
   * Show detailed progress breakdown
   * Default: true
   */
  showProgress?: boolean;
}

export function ProfileCompletionModal({
  open,
  onOpenChange,
  dismissible = true,
  title,
  description,
  onProfileComplete,
  showProgress = true,
}: ProfileCompletionModalProps) {
  const {
    isEmailConfirmed,
    isComplete,
    canAccessProtectedFeatures,
    nextStep,
    statusMessage,
    missingFields,
  } = useProfileCompletion();

  // Auto-close modal when profile becomes complete
  useEffect(() => {
    if (canAccessProtectedFeatures && open) {
      if (onProfileComplete) {
        onProfileComplete();
      } else {
        onOpenChange(false);
      }
    }
  }, [canAccessProtectedFeatures, open, onOpenChange, onProfileComplete]);

  // Calculate completion percentage
  const getCompletionPercentage = () => {
    let completed = 0;
    const total = 2; // email confirmation + profile completion

    if (isEmailConfirmed) completed++;
    if (isComplete) completed++;

    return (completed / total) * 100;
  };

  const getStepIcon = (step: string, isCompleted: boolean) => {
    if (isCompleted) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }

    switch (step) {
      case 'confirm_email':
        return <Mail className="h-5 w-5 text-orange-500" />;
      case 'complete_profile':
        return <User className="h-5 w-5 text-blue-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getPrimaryAction = () => {
    switch (nextStep) {
      case 'confirm_email':
        return {
          label: 'Resend Confirmation Email',
          href: '/auth/sign-up-success',
          icon: Mail,
        };
      case 'complete_profile':
        return {
          label: 'Complete Profile',
          href: '/complete-profile',
          icon: User,
        };
      default:
        return null;
    }
  };

  const primaryAction = getPrimaryAction();

  return (
    <Dialog open={open} onOpenChange={dismissible ? onOpenChange : undefined}>
      <DialogContent className="sm:max-w-md" closable={dismissible}>
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
            <AlertTriangle className="h-6 w-6 text-orange-600" />
          </div>
          <DialogTitle className="text-center">{title || 'Complete Your Profile'}</DialogTitle>
          <DialogDescription className="text-center">
            {description || 'Please complete the required steps to access this feature.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Progress Section */}
          {showProgress && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Account Setup</span>
                  <span className="font-medium">{Math.round(getCompletionPercentage())}%</span>
                </div>
                <Progress value={getCompletionPercentage()} className="h-2" />
              </div>

              {/* Step Details */}
              <div className="space-y-3">
                {/* Email Confirmation Step */}
                <div className="flex items-center space-x-3">
                  {getStepIcon('confirm_email', isEmailConfirmed)}
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {isEmailConfirmed ? 'Email Confirmed' : 'Confirm Email Address'}
                    </p>
                    {!isEmailConfirmed && (
                      <p className="text-xs text-muted-foreground">
                        Check your inbox and click the confirmation link
                      </p>
                    )}
                  </div>
                </div>

                {/* Profile Completion Step */}
                <div className="flex items-center space-x-3">
                  {getStepIcon('complete_profile', isComplete)}
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {isComplete ? 'Profile Complete' : 'Complete Profile Information'}
                    </p>
                    {!isComplete && missingFields.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Missing: {missingFields.map((field) => field.replace(/_/g, ' ')).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Current Status */}
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground mb-1">Next Step Required</p>
                <p className="text-muted-foreground">{statusMessage}</p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-col space-y-2">
          {/* Primary Action */}
          {primaryAction && (
            <Link href={primaryAction.href} className="w-full">
              <Button className="w-full">
                <primaryAction.icon className="mr-2 h-4 w-4" />
                {primaryAction.label}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          )}

          {/* Secondary Actions */}
          <div className="flex w-full space-x-2">
            {dismissible && (
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                Continue Without Completing
              </Button>
            )}

            <Link href="/schedule" className="flex-1">
              <Button variant="ghost" className="w-full">
                Browse Schedule
              </Button>
            </Link>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to automatically show profile completion modal when needed
 */
export function useProfileCompletionModal() {
  const [isOpen, setIsOpen] = useState(false);
  const { canAccessProtectedFeatures, nextStep } = useProfileCompletion();

  const showModalIfNeeded = () => {
    if (!canAccessProtectedFeatures) {
      setIsOpen(true);
      return true;
    }
    return false;
  };

  const closeModal = () => setIsOpen(false);

  return {
    isOpen,
    showModal: showModalIfNeeded,
    closeModal,
    nextStep,
    canAccess: canAccessProtectedFeatures,
  };
}
