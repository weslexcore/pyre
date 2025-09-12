'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  sessionTimeoutManager,
  type TimeoutWarning,
  type SessionTimeoutConfig,
} from '@/lib/supabase/session-timeout-manager';
import { useAuthState } from './use-auth-state';
import { toast } from 'sonner';

export interface SessionTimeoutState {
  timeRemaining: number | null;
  isExpiringSoon: boolean;
  idleTime: number;
  lastWarning: TimeoutWarning | null;
  isIdle: boolean;
}

export interface UseSessionTimeoutOptions extends Partial<SessionTimeoutConfig> {
  onTimeoutWarning?: (warning: TimeoutWarning) => void;
  onSessionExpired?: () => void;
  onIdleWarning?: (idleTime: number) => void;
  showToastNotifications?: boolean;
  autoExtendOnActivity?: boolean;
}

export function useSessionTimeout(options: UseSessionTimeoutOptions = {}) {
  const {
    onTimeoutWarning,
    onSessionExpired,
    onIdleWarning,
    showToastNotifications = true,
    autoExtendOnActivity = true,
  } = options;

  const timeoutConfig = useMemo<Partial<SessionTimeoutConfig>>(() => {
    return {
      warningThresholdMinutes: options.warningThresholdMinutes,
      checkIntervalMs: options.checkIntervalMs,
      autoRefreshEnabled: options.autoRefreshEnabled,
      showWarningNotifications: options.showWarningNotifications,
      enableIdleDetection: options.enableIdleDetection,
      idleTimeoutMinutes: options.idleTimeoutMinutes,
    };
  }, [
    options.warningThresholdMinutes,
    options.checkIntervalMs,
    options.autoRefreshEnabled,
    options.showWarningNotifications,
    options.enableIdleDetection,
    options.idleTimeoutMinutes,
  ]);

  const { session, isLoading } = useAuthState();
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [state, setState] = useState<SessionTimeoutState>({
    timeRemaining: null,
    isExpiringSoon: false,
    idleTime: 0,
    lastWarning: null,
    isIdle: false,
  });

  // Update timeout manager config
  useEffect(() => {
    if (Object.keys(timeoutConfig).length > 0) {
      sessionTimeoutManager.updateConfig(timeoutConfig);
    }
  }, [timeoutConfig]);

  const updateState = useCallback(() => {
    const timeRemaining = sessionTimeoutManager.getSessionTimeRemaining();
    const idleTime = sessionTimeoutManager.getIdleTime();
    const isExpiringSoon = sessionTimeoutManager.isSessionExpiringSoon();
    const isIdle = idleTime > (timeoutConfig.idleTimeoutMinutes || 15) * 60 * 1000;

    setState((prev) => ({
      ...prev,
      timeRemaining,
      idleTime,
      isExpiringSoon,
      isIdle,
    }));
  }, [timeoutConfig.idleTimeoutMinutes]);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const result = await sessionTimeoutManager.manualRefresh();

      if (result) {
        toast.success('Session Refreshed', {
          description: 'Your session has been successfully renewed.',
        });
        updateState();
      } else {
        toast.error('Refresh Failed', {
          description: 'Unable to refresh session. Please log in again.',
        });
      }

      return result;
    } catch (error) {
      toast.error('Refresh Error', {
        description: error instanceof Error ? error.message : 'Failed to refresh session.',
      });
      return false;
    }
  }, [updateState]);

  const extendSession = useCallback(() => {
    sessionTimeoutManager.extendSession();
    updateState();

    if (showToastNotifications) {
      toast.success('Session Extended', {
        description: 'Your session has been extended due to activity.',
      });
    }
  }, [updateState, showToastNotifications]);

  const handleTimeoutWarning = useCallback(
    (warning: TimeoutWarning) => {
      setState((prev) => ({ ...prev, lastWarning: warning }));

      // Show toast notifications
      if (showToastNotifications) {
        const toastOptions = {
          duration: 10000, // 10 seconds
        };

        switch (warning.type) {
          case 'expiring':
            toast.warning('Session Expiring', {
              description: warning.message,
              ...toastOptions,
              action:
                warning.recommendedAction === 'refresh'
                  ? {
                      label: 'Refresh Now',
                      onClick: () => refreshSession(),
                    }
                  : {
                      label: 'Log In',
                      onClick: () => {
                        window.location.href = '/auth/login';
                      },
                    },
            });
            break;
          case 'expired':
            toast.error('Session Expired', {
              description: warning.message,
              ...toastOptions,
            });
            if (onSessionExpired) {
              onSessionExpired();
            }
            break;
          case 'idle':
            toast.info('Idle Session', {
              description: warning.message,
              ...toastOptions,
              action: {
                label: 'Continue Session',
                onClick: () => extendSession(),
              },
            });
            if (onIdleWarning) {
              onIdleWarning(state.idleTime);
            }
            break;
        }
      }

      // Call custom callback
      if (onTimeoutWarning) {
        onTimeoutWarning(warning);
      }
    },
    [
      showToastNotifications,
      onTimeoutWarning,
      onSessionExpired,
      onIdleWarning,
      state.idleTime,
      extendSession,
      refreshSession,
    ]
  );

  const formatTimeRemaining = useCallback((seconds: number): string => {
    if (seconds <= 0) return 'Expired';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }, []);

  const getTimeRemainingPercentage = useCallback((): number => {
    if (!state.timeRemaining) return 100;

    // Assume initial session is 24 hours (86400 seconds)
    const initialSessionTime = 24 * 60 * 60;
    return Math.max(0, (state.timeRemaining / initialSessionTime) * 100);
  }, [state.timeRemaining]);

  // Set up timeout warning listener
  useEffect(() => {
    if (!isLoading && session) {
      const unsubscribe = sessionTimeoutManager.onTimeoutWarning(handleTimeoutWarning);
      return unsubscribe;
    }
  }, [session, isLoading, handleTimeoutWarning]);

  // Set up state update interval
  useEffect(() => {
    if (!isLoading && session) {
      // Initial update
      updateState();

      // Set up interval to update state every 10 seconds
      updateIntervalRef.current = setInterval(updateState, 10000);

      return () => {
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
          updateIntervalRef.current = null;
        }
      };
    }
  }, [session, isLoading, updateState]);

  // Auto-extend on activity
  useEffect(() => {
    if (!autoExtendOnActivity || !session) return;

    const handleActivity = () => {
      if (state.isIdle) {
        extendSession();
      }
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [autoExtendOnActivity, session, state.isIdle, extendSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, []);

  return {
    ...state,
    refreshSession,
    extendSession,
    formatTimeRemaining: state.timeRemaining ? formatTimeRemaining(state.timeRemaining) : null,
    timeRemainingPercentage: getTimeRemainingPercentage(),
    isSessionActive: !isLoading && !!session && (state.timeRemaining || 0) > 0,
    shouldShowWarning: state.isExpiringSoon || state.isIdle,
  };
}
