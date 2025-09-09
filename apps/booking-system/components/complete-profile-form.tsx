'use client';

import { useState, useEffect, useId } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProfile } from '@/hooks/use-profile';
import { validateProfileData, type ProfileData } from '@/lib/utils/profile';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { User, ArrowRight, Shield } from 'lucide-react';

export function CompleteProfileForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const { user, profile, updateProfile, isLoadingUser } = useProfile();
  const router = useRouter();

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Track if form has been initialized
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Generate unique IDs for form fields
  const formId = useId();
  const firstNameId = `${formId}-firstName`;
  const lastNameId = `${formId}-lastName`;
  const dateOfBirthId = `${formId}-dateOfBirth`;

  // Initialize form when profile data is first loaded
  useEffect(() => {
    if (!isLoadingUser && user && !isInitialized) {
      setFirstName(profile?.first_name ?? '');
      setLastName(profile?.last_name ?? '');
      setDateOfBirth(profile?.date_of_birth ?? '');
      setIsInitialized(true);
    }
  }, [user, profile, isLoadingUser, isInitialized]);

  // Redirect if profile is already complete
  useEffect(() => {
    if (!isLoadingUser && user && profile?.first_name && profile?.last_name && profile?.date_of_birth) {
      router.push('/schedule');
    }
  }, [user, profile, isLoadingUser, router]);

  const validateForm = (): boolean => {
    const profileData: Partial<ProfileData> = {
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
    };

    const validation = validateProfileData(profileData);
    setErrors(validation.errors);
    return validation.valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors below');
      return;
    }

    setIsSubmitting(true);
    
    try {
      await updateProfile.mutateAsync({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth,
      });
      
      toast.success('Profile completed successfully!');
      router.push('/schedule');
    } catch (error) {
      // Error handling is done in the hook via toast
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipForNow = () => {
    router.push('/schedule');
  };

  if (isLoadingUser) {
    return (
      <div className={cn('flex flex-col gap-6', className)} {...props}>
        <Card>
          <CardHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <User className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl text-center">Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="animate-pulse space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                <div className="h-10 bg-gray-200 rounded"></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <User className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Complete Your Profile</CardTitle>
          <CardDescription>
            Just a few details to get you started with Pyre
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor={firstNameId}>First Name *</Label>
                  <Input
                    id={firstNameId}
                    type="text"
                    placeholder="Enter your first name"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={errors.first_name ? 'border-red-500' : ''}
                  />
                  {errors.first_name && (
                    <p className="text-sm text-red-500">{errors.first_name}</p>
                  )}
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor={lastNameId}>Last Name *</Label>
                  <Input
                    id={lastNameId}
                    type="text"
                    placeholder="Enter your last name"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={errors.last_name ? 'border-red-500' : ''}
                  />
                  {errors.last_name && (
                    <p className="text-sm text-red-500">{errors.last_name}</p>
                  )}
                </div>
              </div>

              {/* Date of Birth */}
              <div className="grid gap-2">
                <Label htmlFor={dateOfBirthId}>Date of Birth *</Label>
                <Input
                  id={dateOfBirthId}
                  type="date"
                  required
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className={errors.date_of_birth ? 'border-red-500' : ''}
                />
                {errors.date_of_birth && (
                  <p className="text-sm text-red-500">{errors.date_of_birth}</p>
                )}
              </div>

              {/* Privacy Notice */}
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start space-x-3">
                  <Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Privacy Notice</p>
                    <p>
                      Your personal information is securely stored and will only be used to personalize your sauna experience and comply with safety requirements.
                    </p>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <Button 
                type="submit" 
                className="w-full" 
                disabled={isSubmitting || updateProfile.isPending}
              >
                {isSubmitting || updateProfile.isPending ? (
                  'Completing Profile...'
                ) : (
                  <>
                    Complete Profile
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              {/* Skip Option */}
              <div className="text-center">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleSkipForNow}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Skip for now, I'll complete this later
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
