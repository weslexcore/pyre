'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface AuthTransitionContextType {
  showTransition: (message: string, duration?: number) => void;
  hideTransition: () => void;
  isTransitioning: boolean;
}

const AuthTransitionContext = createContext<AuthTransitionContextType | undefined>(undefined);

export function useAuthTransition() {
  const context = useContext(AuthTransitionContext);
  if (!context) {
    throw new Error('useAuthTransition must be used within an AuthTransitionProvider');
  }
  return context;
}

interface AuthTransitionProviderProps {
  children: ReactNode;
}

export function AuthTransitionProvider({ children }: AuthTransitionProviderProps) {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState('');

  const hideTransition = useCallback(() => {
    setIsTransitioning(false);
    setTimeout(() => {
      setTransitionMessage('');
    }, 300); // Wait for fade out animation
  }, []);

  const showTransition = useCallback(
    (message: string, duration = 2000) => {
      setTransitionMessage(message);
      setIsTransitioning(true);

      if (duration > 0) {
        setTimeout(() => {
          hideTransition();
        }, duration);
      }
    },
    [hideTransition]
  );

  return (
    <AuthTransitionContext.Provider value={{ showTransition, hideTransition, isTransitioning }}>
      {children}
      <ManualAuthTransitionOverlay show={isTransitioning} message={transitionMessage} />
    </AuthTransitionContext.Provider>
  );
}

interface ManualAuthTransitionOverlayProps {
  show: boolean;
  message: string;
}

function ManualAuthTransitionOverlay({ show, message }: ManualAuthTransitionOverlayProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="text-lg font-semibold">{message}</div>
      </div>
    </div>
  );
}
