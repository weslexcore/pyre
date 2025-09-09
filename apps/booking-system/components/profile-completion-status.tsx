'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, AlertCircle, Mail, User } from 'lucide-react';
import { useProfileCompletion } from '@/hooks/use-profile';
import Link from 'next/link';

interface ProfileCompletionStatusProps {
  showCard?: boolean;
  showProgress?: boolean;
  className?: string;
}

export function ProfileCompletionStatus({ 
  showCard = true, 
  showProgress = true,
  className 
}: ProfileCompletionStatusProps) {
  const {
    isEmailConfirmed,
    isComplete,
    canAccessProtectedFeatures,
    nextStep,
    statusMessage,
    missingFields
  } = useProfileCompletion();

  if (canAccessProtectedFeatures) {
    return null; // Don't show anything if everything is complete
  }

  const getStepIcon = (step: string) => {
    switch (step) {
      case 'confirm_email':
        return <Mail className="h-5 w-5 text-orange-500" />;
      case 'complete_profile':
        return <User className="h-5 w-5 text-blue-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStepButton = (step: string) => {
    switch (step) {
      case 'confirm_email':
        return (
          <Link href="/auth/sign-up-success">
            <Button size="sm">
              <Mail className="mr-2 h-4 w-4" />
              Resend Confirmation
            </Button>
          </Link>
        );
      case 'complete_profile':
        return (
          <Link href="/complete-profile">
            <Button size="sm">
              <User className="mr-2 h-4 w-4" />
              Complete Profile
            </Button>
          </Link>
        );
      default:
        return null;
    }
  };

  const getCompletionPercentage = () => {
    let completed = 0;
    const total = 2; // email confirmation + profile completion

    if (isEmailConfirmed) completed++;
    if (isComplete) completed++;

    return (completed / total) * 100;
  };

  const content = (
    <div className="space-y-4">
      {showProgress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Account Setup</span>
            <span className="font-medium">{Math.round(getCompletionPercentage())}%</span>
          </div>
          <Progress value={getCompletionPercentage()} className="h-2" />
        </div>
      )}

      <div className="space-y-3">
        {/* Email Confirmation Step */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {isEmailConfirmed ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <Mail className="h-5 w-5 text-orange-500" />
            )}
            <div>
              <p className="text-sm font-medium">
                {isEmailConfirmed ? 'Email Confirmed' : 'Confirm Email'}
              </p>
              {!isEmailConfirmed && (
                <p className="text-xs text-muted-foreground">
                  Check your inbox and click the confirmation link
                </p>
              )}
            </div>
          </div>
          {!isEmailConfirmed && nextStep === 'confirm_email' && (
            <Link href="/auth/sign-up-success">
              <Button size="sm" variant="outline">
                Resend
              </Button>
            </Link>
          )}
        </div>

        {/* Profile Completion Step */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {isComplete ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <User className="h-5 w-5 text-blue-500" />
            )}
            <div>
              <p className="text-sm font-medium">
                {isComplete ? 'Profile Complete' : 'Complete Profile'}
              </p>
              {!isComplete && missingFields.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Missing: {missingFields.map(field => 
                    field.replace(/_/g, ' ')
                  ).join(', ')}
                </p>
              )}
            </div>
          </div>
          {!isComplete && nextStep === 'complete_profile' && (
            <Link href="/complete-profile">
              <Button size="sm" variant="outline">
                Complete
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Current Status */}
      <div className="pt-2 border-t">
        <div className="flex items-center space-x-2">
          {getStepIcon(nextStep)}
          <p className="text-sm text-muted-foreground">{statusMessage}</p>
        </div>
        {nextStep !== 'all_complete' && (
          <div className="mt-2">
            {getStepButton(nextStep)}
          </div>
        )}
      </div>
    </div>
  );

  if (showCard) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          {content}
        </CardContent>
      </Card>
    );
  }

  return <div className={className}>{content}</div>;
}

/**
 * Simple inline status indicator
 */
export function ProfileCompletionIndicator() {
  const { canAccessProtectedFeatures, nextStep, statusMessage } = useProfileCompletion();

  if (canAccessProtectedFeatures) {
    return (
      <div className="flex items-center space-x-2 text-green-600">
        <CheckCircle className="h-4 w-4" />
        <span className="text-sm">Account Ready</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 text-orange-600">
      <AlertCircle className="h-4 w-4" />
      <span className="text-sm">{statusMessage}</span>
    </div>
  );
}