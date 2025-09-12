'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAuthState } from '@/hooks/use-auth-state';

export function LogoutButton({ onAfter }: { onAfter?: () => void }) {
  const router = useRouter();
  const { isAuthenticated } = useAuthState();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState<string>('');

  useEffect(() => {
    if (isLoggingOut && !isAuthenticated) {
      const handleSuccessfulLogout = async () => {
        try {
          setLogoutMessage('Redirecting...');

          // Rely on RSC refresh triggered by SupabaseAuthListener
          router.replace('/auth/login');
          onAfter?.();
        } catch (error) {
          console.warn('Logout validation warning:', error);
          // Still proceed with logout even if validation fails
          setLogoutMessage('Redirecting...');

          router.replace('/auth/login');
          onAfter?.();
        } finally {
          setIsLoggingOut(false);
          setLogoutMessage('');
        }
      };

      handleSuccessfulLogout();
    }
  }, [isAuthenticated, isLoggingOut, router, onAfter]);

  const logout = async () => {
    setIsLoggingOut(true);
    setLogoutMessage('Signing out...');

    const supabase = createClient();
    await supabase.auth.signOut();
    // Auth state change will be handled by useEffect above
  };

  return (
    <Button onClick={logout} className="font-mono-bold" disabled={isLoggingOut}>
      {isLoggingOut ? (
        <div className="flex items-center gap-2">
          <LoadingSpinner size="sm" />
          {logoutMessage || 'LOGGING OUT'}
        </div>
      ) : (
        'LOGOUT'
      )}
    </Button>
  );
}
