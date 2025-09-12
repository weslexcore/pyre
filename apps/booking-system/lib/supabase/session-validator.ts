'use client';

import { createClient } from './client';
import { authEventManager } from './auth-events';
import { sessionPersistenceValidator } from './session-persistence-validator';
import type { Session, AuthError } from '@supabase/supabase-js';

export interface SessionValidationConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  enableValidationLogging: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  session: Session | null;
  error?: AuthError | Error;
  retryCount: number;
  validationType: 'fresh' | 'cached' | 'recovered';
  duration: number;
}

export interface RetryContext {
  attempt: number;
  lastError?: AuthError | Error;
  startTime: number;
  totalDelay: number;
}

export class SessionValidator {
  private static instance: SessionValidator;
  private validationCache = new Map<string, { result: ValidationResult; timestamp: number }>();
  private activeValidations = new Map<string, Promise<ValidationResult>>();

  private constructor(private config: SessionValidationConfig) {}

  static getInstance(config?: Partial<SessionValidationConfig>): SessionValidator {
    const defaultConfig: SessionValidationConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      timeoutMs: 10000,
      enableValidationLogging: process.env.NODE_ENV === 'development',
    };

    if (!SessionValidator.instance) {
      SessionValidator.instance = new SessionValidator({
        ...defaultConfig,
        ...config,
      });
    }
    return SessionValidator.instance;
  }

  public async validateSession(
    options: { forceRefresh?: boolean; requireAuth?: boolean; cacheKey?: string } = {}
  ): Promise<ValidationResult> {
    const cacheKey = options.cacheKey || 'default';
    const startTime = Date.now();

    // Check cache first (unless forced refresh)
    if (!options.forceRefresh) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        this.log('Session validation cache hit', { cacheKey });
        return cached;
      }
    }

    // Check if validation is already in progress
    const activeValidation = this.activeValidations.get(cacheKey);
    if (activeValidation) {
      this.log('Session validation already in progress, waiting...', { cacheKey });
      return activeValidation;
    }

    // Start new validation
    const validationPromise = this.performValidationWithRetry({
      requireAuth: options.requireAuth,
      cacheKey,
      startTime,
    });

    this.activeValidations.set(cacheKey, validationPromise);

    try {
      const result = await validationPromise;
      this.cacheResult(cacheKey, result);
      return result;
    } finally {
      this.activeValidations.delete(cacheKey);
    }
  }

  private async performValidationWithRetry(options: {
    requireAuth?: boolean;
    cacheKey: string;
    startTime: number;
  }): Promise<ValidationResult> {
    const context: RetryContext = {
      attempt: 0,
      startTime: options.startTime,
      totalDelay: 0,
    };

    while (context.attempt < this.config.maxRetries) {
      try {
        context.attempt++;
        this.log(`Session validation attempt ${context.attempt}`, {
          cacheKey: options.cacheKey,
          attempt: context.attempt,
        });

        const result = await this.performSingleValidation(options.requireAuth);

        if (result.isValid || !this.shouldRetry(result.error, context)) {
          return {
            ...result,
            retryCount: context.attempt - 1,
            duration: Date.now() - options.startTime,
          };
        }

        // Prepare for retry
        context.lastError = result.error;
        const delay = this.calculateBackoffDelay(context.attempt);
        context.totalDelay += delay;

        this.log(`Session validation failed, retrying in ${delay}ms`, {
          cacheKey: options.cacheKey,
          attempt: context.attempt,
          error: result.error?.message,
        });

        await this.delay(delay);
      } catch (error) {
        context.lastError = error instanceof Error ? error : new Error(String(error));

        if (context.attempt >= this.config.maxRetries) {
          break;
        }

        const delay = this.calculateBackoffDelay(context.attempt);
        context.totalDelay += delay;
        await this.delay(delay);
      }
    }

    // All retries exhausted
    return {
      isValid: false,
      session: null,
      error: context.lastError || new Error('Session validation failed after maximum retries'),
      retryCount: context.attempt,
      validationType: 'fresh',
      duration: Date.now() - options.startTime,
    };
  }

  private async performSingleValidation(
    requireAuth = false
  ): Promise<Omit<ValidationResult, 'retryCount' | 'duration'>> {
    const supabase = createClient();

    try {
      // First check current auth state from event manager
      const currentState = authEventManager.getCurrentState();

      if (currentState.error) {
        return {
          isValid: false,
          session: null,
          error: new Error(currentState.error),
          validationType: 'cached',
        };
      }

      // Perform fresh session check with server
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        return {
          isValid: false,
          session: null,
          error,
          validationType: 'fresh',
        };
      }

      // No session but auth required
      if (!session && requireAuth) {
        return {
          isValid: false,
          session: null,
          error: new Error('Authentication required but no session found'),
          validationType: 'fresh',
        };
      }

      // No session but auth not required
      if (!session && !requireAuth) {
        return {
          isValid: true,
          session: null,
          validationType: 'fresh',
        };
      }

      // Session exists - validate its health
      if (session) {
        const healthCheck = await sessionPersistenceValidator.checkSessionHealth();

        if (!healthCheck.isValid) {
          // Attempt recovery
          const recovered = await this.attemptSessionRecovery();
          if (recovered) {
            return {
              isValid: true,
              session: recovered,
              validationType: 'recovered',
            };
          }

          return {
            isValid: false,
            session: null,
            error: new Error(healthCheck.error || 'Session health check failed'),
            validationType: 'fresh',
          };
        }

        return {
          isValid: true,
          session,
          validationType: 'fresh',
        };
      }

      return {
        isValid: false,
        session: null,
        error: new Error('Unexpected validation state'),
        validationType: 'fresh',
      };
    } catch (error) {
      return {
        isValid: false,
        session: null,
        error: error instanceof Error ? error : new Error(String(error)),
        validationType: 'fresh',
      };
    }
  }

  private async attemptSessionRecovery(): Promise<Session | null> {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.refreshSession();

      if (error || !data.session) {
        this.log('Session recovery failed', { error: error?.message });
        return null;
      }

      this.log('Session recovery successful');
      return data.session;
    } catch (error) {
      this.log('Session recovery error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private shouldRetry(error: AuthError | Error | undefined, context: RetryContext): boolean {
    if (!error) return false;
    if (context.attempt >= this.config.maxRetries) return false;
    if (context.totalDelay >= this.config.maxDelayMs) return false;

    // Don't retry certain errors
    const nonRetryableErrors = [
      'Invalid login credentials',
      'Email not confirmed',
      'User not found',
      'Invalid token',
    ];

    const errorMessage = error.message.toLowerCase();
    return !nonRetryableErrors.some((nonRetryable) =>
      errorMessage.includes(nonRetryable.toLowerCase())
    );
  }

  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = this.config.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay; // Add 10% jitter
    const delay = Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
    return Math.floor(delay);
  }

  private getCachedResult(cacheKey: string): ValidationResult | null {
    const cached = this.validationCache.get(cacheKey);
    if (!cached) return null;

    // Cache valid for 30 seconds
    const maxAge = 30 * 1000;
    if (Date.now() - cached.timestamp > maxAge) {
      this.validationCache.delete(cacheKey);
      return null;
    }

    return cached.result;
  }

  private cacheResult(cacheKey: string, result: ValidationResult): void {
    // Only cache successful results or specific errors
    if (result.isValid || result.validationType === 'recovered') {
      this.validationCache.set(cacheKey, {
        result,
        timestamp: Date.now(),
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.enableValidationLogging) {
      console.log(`[SessionValidator] ${message}`, data || '');
    }
  }

  public clearCache(): void {
    this.validationCache.clear();
    this.log('Validation cache cleared');
  }

  public getActiveValidations(): string[] {
    return Array.from(this.activeValidations.keys());
  }

  public getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.validationCache.size,
      keys: Array.from(this.validationCache.keys()),
    };
  }
}

// Export singleton instance
export const sessionValidator = SessionValidator.getInstance();
