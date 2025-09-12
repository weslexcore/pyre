'use client';

import { createClient } from './client';
import { authEventManager } from './auth-events';
import type { Session } from '@supabase/supabase-js';

export interface SessionValidationResult {
  isValid: boolean;
  session: Session | null;
  needsRefresh: boolean;
  error?: string;
  validationTimestamp: number;
}

export interface SessionPersistenceConfig {
  validationInterval: number;
  maxValidationRetries: number;
  sessionTimeoutMs: number;
  enablePeriodicValidation: boolean;
}

export class SessionPersistenceValidator {
  private static instance: SessionPersistenceValidator;
  private validationInterval: NodeJS.Timeout | null = null;
  private lastValidationTime = 0;
  private validationInProgress = false;

  private constructor(private config: SessionPersistenceConfig) {
    this.initializeValidation();
  }

  static getInstance(config?: Partial<SessionPersistenceConfig>): SessionPersistenceValidator {
    const defaultConfig: SessionPersistenceConfig = {
      validationInterval: 60000, // 1 minute
      maxValidationRetries: 3,
      sessionTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
      enablePeriodicValidation: true,
    };

    if (!SessionPersistenceValidator.instance) {
      SessionPersistenceValidator.instance = new SessionPersistenceValidator({
        ...defaultConfig,
        ...config,
      });
    }
    return SessionPersistenceValidator.instance;
  }

  private initializeValidation() {
    if (typeof window === 'undefined') return;

    // Validate on page load
    this.validateSessionOnLoad();

    // Set up periodic validation
    if (this.config.enablePeriodicValidation) {
      this.startPeriodicValidation();
    }

    // Validate when page becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.validateSessionPersistence();
      }
    });

    // Validate when window regains focus
    window.addEventListener('focus', () => {
      this.validateSessionPersistence();
    });

    // Validate before page unload
    window.addEventListener('beforeunload', () => {
      this.performSyncValidation();
    });
  }

  private async validateSessionOnLoad() {
    // Wait a bit for auth to initialize
    setTimeout(() => {
      this.validateSessionPersistence();
    }, 1000);
  }

  private startPeriodicValidation() {
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
    }

    this.validationInterval = setInterval(() => {
      this.validateSessionPersistence();
    }, this.config.validationInterval);
  }

  public async validateSessionPersistence(): Promise<SessionValidationResult> {
    if (this.validationInProgress) {
      return this.getLastValidationResult();
    }

    this.validationInProgress = true;

    try {
      const result = await this.performValidation();
      this.lastValidationTime = Date.now();

      // Handle validation results
      if (!result.isValid && result.needsRefresh) {
        await this.attemptSessionRecovery();
      }

      return result;
    } finally {
      this.validationInProgress = false;
    }
  }

  private async performValidation(): Promise<SessionValidationResult> {
    const supabase = createClient();
    const currentAuthState = authEventManager.getCurrentState();

    try {
      // Check if we have a current session in memory
      if (!currentAuthState.session) {
        return {
          isValid: false,
          session: null,
          needsRefresh: false,
          error: 'No session in memory',
          validationTimestamp: Date.now(),
        };
      }

      // Validate session with server
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        return {
          isValid: false,
          session: null,
          needsRefresh: true,
          error: error.message,
          validationTimestamp: Date.now(),
        };
      }

      if (!session) {
        return {
          isValid: false,
          session: null,
          needsRefresh: false,
          error: 'No session returned from server',
          validationTimestamp: Date.now(),
        };
      }

      // Check if session is expired or close to expiring
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = session.expires_at || 0;
      const timeToExpiry = expiresAt - now;

      // Consider session invalid if it expires in less than 5 minutes
      if (timeToExpiry < 300) {
        return {
          isValid: false,
          session,
          needsRefresh: true,
          error: 'Session expires soon',
          validationTimestamp: Date.now(),
        };
      }

      // Validate session consistency between memory and server
      const memorySessionId = currentAuthState.session.user?.id;
      const serverSessionId = session.user?.id;

      if (memorySessionId !== serverSessionId) {
        return {
          isValid: false,
          session,
          needsRefresh: true,
          error: 'Session inconsistency detected',
          validationTimestamp: Date.now(),
        };
      }

      // Session is valid
      return {
        isValid: true,
        session,
        needsRefresh: false,
        validationTimestamp: Date.now(),
      };
    } catch (error) {
      return {
        isValid: false,
        session: null,
        needsRefresh: true,
        error: error instanceof Error ? error.message : 'Validation failed',
        validationTimestamp: Date.now(),
      };
    }
  }

  private async attemptSessionRecovery(): Promise<boolean> {
    const supabase = createClient();
    let retries = 0;

    while (retries < this.config.maxValidationRetries) {
      try {
        const { data, error } = await supabase.auth.refreshSession();

        if (!error && data.session) {
          console.log('Session recovery successful');
          return true;
        }

        retries++;
        await this.delay(1000 * retries); // Exponential backoff
      } catch (error) {
        console.warn(`Session recovery attempt ${retries + 1} failed:`, error);
        retries++;
      }
    }

    console.warn('Session recovery failed after all attempts');
    return false;
  }

  private performSyncValidation(): SessionValidationResult {
    const currentAuthState = authEventManager.getCurrentState();

    if (!currentAuthState.session) {
      return {
        isValid: false,
        session: null,
        needsRefresh: false,
        error: 'No session available',
        validationTimestamp: Date.now(),
      };
    }

    // Quick synchronous validation
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = currentAuthState.session.expires_at || 0;
    const isExpired = expiresAt <= now;

    return {
      isValid: !isExpired,
      session: currentAuthState.session,
      needsRefresh: isExpired,
      error: isExpired ? 'Session expired' : undefined,
      validationTimestamp: Date.now(),
    };
  }

  private getLastValidationResult(): SessionValidationResult {
    const currentAuthState = authEventManager.getCurrentState();

    return {
      isValid: !!currentAuthState.session && !currentAuthState.error,
      session: currentAuthState.session,
      needsRefresh: false,
      error: currentAuthState.error || undefined,
      validationTimestamp: this.lastValidationTime,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Public API methods
  public async checkSessionHealth(): Promise<SessionValidationResult> {
    return this.validateSessionPersistence();
  }

  public getLastValidationTimestamp(): number {
    return this.lastValidationTime;
  }

  public isValidationInProgress(): boolean {
    return this.validationInProgress;
  }

  public destroy(): void {
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
      this.validationInterval = null;
    }
    this.validationInProgress = false;
  }

  // Utility method to check if session validation is needed
  public shouldValidateSession(): boolean {
    const timeSinceLastValidation = Date.now() - this.lastValidationTime;
    return timeSinceLastValidation > this.config.validationInterval;
  }
}

// Export singleton instance
export const sessionPersistenceValidator = SessionPersistenceValidator.getInstance();
