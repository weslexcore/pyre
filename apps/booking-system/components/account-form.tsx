'use client';

import { useState, useEffect, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProfile } from '@/hooks/use-profile';
import { validateProfileData, type ProfileData } from '@/lib/utils/profile';
import { updateUserEmail } from '@/lib/supabase/client-queries';
import { toast } from 'sonner';

export function AccountForm() {
  const { user, profile, updateProfile, isLoadingUser } = useProfile();
  
  // Form state
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  
  // Track if form has been initialized
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Form state
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [emailChanged, setEmailChanged] = useState(false);
  
  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Stable IDs for inputs and labels
  const formId = useId();
  const firstNameId = `${formId}-firstName`;
  const lastNameId = `${formId}-lastName`;
  const dateOfBirthId = `${formId}-dateOfBirth`;
  const phoneId = `${formId}-phone`;
  const emailId = `${formId}-email`;

  // Initialize form when profile data is first loaded
  useEffect(() => {
    if (!isLoadingUser && user && !isInitialized) {
      setEmail(user.email ?? '');
      setFirstName(profile.first_name ?? '');
      setLastName(profile.last_name ?? '');
      setDateOfBirth(profile.date_of_birth ?? '');
      setPhone(profile.phone ?? '');
      setIsInitialized(true);
    }
  }, [user, profile, isLoadingUser, isInitialized]);

  // Check if email has changed
  useEffect(() => {
    setEmailChanged(email !== user?.email);
  }, [email, user?.email]);

  const validateForm = (): boolean => {
    const profileData: Partial<ProfileData> = {
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
      phone: phone,
    };

    const validation = validateProfileData(profileData);
    setErrors(validation.errors);
    return validation.valid;
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors below');
      return;
    }

    setIsUpdatingProfile(true);
    
    try {
      await updateProfile.mutateAsync({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth,
        phone: phone.trim() || undefined,
      });
      
      setErrors({});
      // The form will automatically update with the new values from the hook
      // after a successful mutation due to React Query's cache invalidation
    } catch (_error) {
      // Error handling is done in the hook
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleUpdateEmail = async () => {
    if (!emailChanged || !email.trim()) return;
    
    setIsUpdatingEmail(true);
    
    try {
      await updateUserEmail(email.trim());
      toast.success('Email update initiated. Check your inbox for confirmation.');
      setEmailChanged(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update email');
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  // Show loading state while profile data is being fetched
  if (isLoadingUser || !isInitialized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Account Information</CardTitle>
          <CardDescription>Loading your profile information...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                <div className="h-10 bg-gray-200 rounded"></div>
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                <div className="h-10 bg-gray-200 rounded"></div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-10 bg-gray-200 rounded"></div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
              <div className="h-10 bg-gray-200 rounded"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Account Information</CardTitle>
        <CardDescription>Update your personal details and contact information.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleUpdateProfile} className="space-y-6">
          {/* Profile Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Personal Information</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={firstNameId}>First Name *</Label>
                <Input
                  id={firstNameId}
                  type="text"
                  placeholder="Enter your first name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={errors.first_name ? 'border-red-500' : ''}
                />
                {errors.first_name && (
                  <p className="text-sm text-red-500">{errors.first_name}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor={lastNameId}>Last Name *</Label>
                <Input
                  id={lastNameId}
                  type="text"
                  placeholder="Enter your last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={errors.last_name ? 'border-red-500' : ''}
                />
                {errors.last_name && (
                  <p className="text-sm text-red-500">{errors.last_name}</p>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor={dateOfBirthId}>Date of Birth *</Label>
              <Input
                id={dateOfBirthId}
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={errors.date_of_birth ? 'border-red-500' : ''}
              />
              {errors.date_of_birth && (
                <p className="text-sm text-red-500">{errors.date_of_birth}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor={phoneId}>Phone Number (Optional)</Label>
              <Input
                id={phoneId}
                type="tel"
                placeholder="Enter your phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={errors.phone ? 'border-red-500' : ''}
              />
              {errors.phone && (
                <p className="text-sm text-red-500">{errors.phone}</p>
              )}
            </div>
          </div>

          {/* Email Section */}
          <div className="space-y-4 border-t pt-6">
            <h3 className="text-lg font-medium">Email Address</h3>
            
            <div className="space-y-2">
              <Label htmlFor={emailId}>Email *</Label>
              <div className="flex gap-2">
                <Input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1"
                />
                {emailChanged && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUpdateEmail}
                    disabled={isUpdatingEmail}
                  >
                    {isUpdatingEmail ? 'Updating...' : 'Update Email'}
                  </Button>
                )}
              </div>
              {emailChanged && (
                <p className="text-xs text-muted-foreground">
                  Changing your email will require email confirmation
                </p>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex gap-3 pt-4">
            <Button 
              type="submit" 
              disabled={isUpdatingProfile || updateProfile.isPending}
            >
              {isUpdatingProfile || updateProfile.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">
            * Required fields for profile completion
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
