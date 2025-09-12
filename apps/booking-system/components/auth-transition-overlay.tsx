'use client';

import { useEffect, useState } from 'react';
import { useAuthState } from '@/hooks/use-auth-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

interface AuthTransitionOverlayProps {
  showOnAuthChange?: boolean;
  showOnInitialLoad?: boolean;
  minDisplayTime?: number;
  className?: string;
}

export function AuthTransitionOverlay({
  showOnAuthChange = true,
  showOnInitialLoad = true,
  minDisplayTime = 800,
  className,
}: AuthTransitionOverlayProps) {
  const { isLoading, session } = useAuthState();
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayMessage, setOverlayMessage] = useState<string>('');
  const [fadeOut, setFadeOut] = useState(false);

  // Track auth state changes for transitions
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (isLoading && (showOnInitialLoad || showOnAuthChange)) {
      setShowOverlay(true);
      setFadeOut(false);
      setOverlayMessage('Loading authentication...');
    } else if (showOverlay && !isLoading) {
      // Auth loading finished, show completion message briefly
      if (session) {
        setOverlayMessage('Welcome back!');
      } else {
        setOverlayMessage('Ready to sign in');
      }

      // Start fade out after minimum display time
      timeoutId = setTimeout(() => {
        setFadeOut(true);

        // Hide overlay after fade out animation
        setTimeout(() => {
          setShowOverlay(false);
          setOverlayMessage('');
        }, 300);
      }, minDisplayTime);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading, session, showOverlay, showOnInitialLoad, showOnAuthChange, minDisplayTime]);

  if (!showOverlay) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-300',
        fadeOut ? 'opacity-0' : 'opacity-100',
        className
      )}
      role="dialog"
      aria-label="Authentication loading"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-muted p-4">
          <LoadingSpinner size="lg" className="text-primary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{overlayMessage}</h2>

          {isLoading && (
            <p className="text-sm text-muted-foreground">
              Please wait while we verify your authentication...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
