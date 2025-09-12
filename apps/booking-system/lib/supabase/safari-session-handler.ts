'use client';

import { createClient } from './client';
import { isSafari, isWebKit, isIOS, isPrivateMode } from './cookie-config';
import type { Session } from '@supabase/supabase-js';

export interface SafariSessionOptions {
  enableITPWorkaround: boolean;
  useAlternativeStorage: boolean;
  fallbackToMemoryStorage: boolean;
  sessionRefreshInterval: number;
}

export class SafariSessionHandler {
  private static instance: SafariSessionHandler;
  private sessionCheckInterval: NodeJS.Timeout | null = null;
  private isPrivateModeDetected = false;
  private memoryStorage: Map<string, string> = new Map();

  private constructor(private options: SafariSessionOptions) {
    this.detectPrivateMode();
    this.initializeSessionHandling();
  }

  static getInstance(options?: Partial<SafariSessionOptions>): SafariSessionHandler {
    const defaultOptions: SafariSessionOptions = {
      enableITPWorkaround: true,
      useAlternativeStorage: true,
      fallbackToMemoryStorage: true,
      sessionRefreshInterval: 30000, // 30 seconds
    };

    if (!SafariSessionHandler.instance) {
      SafariSessionHandler.instance = new SafariSessionHandler({
        ...defaultOptions,
        ...options,
      });
    }
    return SafariSessionHandler.instance;
  }

  private async detectPrivateMode() {
    this.isPrivateModeDetected = await isPrivateMode();
  }

  private initializeSessionHandling() {
    if (!this.isSafariOrWebKit()) return;

    // Set up periodic session validation for Safari
    if (this.options.enableITPWorkaround) {
      this.startSessionValidation();
    }

    // Handle page visibility changes (Safari pauses timers when tab is inactive)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.validateAndRefreshSession();
        }
      });
    }

    // Handle focus events (Safari-specific)
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => {
        this.validateAndRefreshSession();
      });
    }
  }

  private isSafariOrWebKit(): boolean {
    return isSafari() || isWebKit() || isIOS();
  }

  private startSessionValidation() {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }

    this.sessionCheckInterval = setInterval(() => {
      this.validateAndRefreshSession();
    }, this.options.sessionRefreshInterval);
  }

  private async validateAndRefreshSession(): Promise<boolean> {
    try {
      const supabase = createClient();
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.warn('Safari session validation error:', error);
        return false;
      }

      if (!session) {
        return false;
      }

      // Check if session is close to expiring (within 5 minutes)
      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      const timeToExpiry = expiresAt ? expiresAt - now : 0;

      if (timeToExpiry < 300) {
        // Less than 5 minutes
        const { data: refreshedSession, error: refreshError } =
          await supabase.auth.refreshSession();

        if (refreshError) {
          console.warn('Safari session refresh error:', refreshError);
          return false;
        }

        return !!refreshedSession.session;
      }

      return true;
    } catch (error) {
      console.warn('Safari session validation failed:', error);
      return false;
    }
  }

  // Alternative storage methods for Safari private mode
  private getAlternativeStorage(): Storage {
    if (this.isPrivateModeDetected || !this.canUseLocalStorage()) {
      return this.createMemoryStorage();
    }
    return localStorage;
  }

  private canUseLocalStorage(): boolean {
    try {
      const testKey = '__safari_storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  private createMemoryStorage(): Storage {
    return {
      length: this.memoryStorage.size,
      key: (index: number) => {
        const keys = Array.from(this.memoryStorage.keys());
        return keys[index] || null;
      },
      getItem: (key: string) => {
        return this.memoryStorage.get(key) || null;
      },
      setItem: (key: string, value: string) => {
        this.memoryStorage.set(key, value);
      },
      removeItem: (key: string) => {
        this.memoryStorage.delete(key);
      },
      clear: () => {
        this.memoryStorage.clear();
      },
    };
  }

  // Safari-specific session persistence
  public async persistSessionSafely(session: Session): Promise<boolean> {
    if (!this.isSafariOrWebKit()) {
      return true; // Not Safari, use default persistence
    }

    try {
      const storage = this.getAlternativeStorage();
      const sessionData = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: session.user,
        timestamp: Date.now(),
      };

      storage.setItem('sb-session-safari', JSON.stringify(sessionData));
      return true;
    } catch (error) {
      console.warn('Safari session persistence failed:', error);
      return false;
    }
  }

  public async getPersistedSession(): Promise<Session | null> {
    if (!this.isSafariOrWebKit()) {
      return null; // Not Safari, use default
    }

    try {
      const storage = this.getAlternativeStorage();
      const sessionDataStr = storage.getItem('sb-session-safari');

      if (!sessionDataStr) {
        return null;
      }

      const sessionData = JSON.parse(sessionDataStr);

      // Check if session data is too old (older than 24 hours)
      const age = Date.now() - sessionData.timestamp;
      if (age > 24 * 60 * 60 * 1000) {
        storage.removeItem('sb-session-safari');
        return null;
      }

      return {
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
        expires_at: sessionData.expires_at,
        expires_in: Math.max(0, sessionData.expires_at - Math.floor(Date.now() / 1000)),
        user: sessionData.user,
        token_type: 'bearer',
        provider_token: null,
        provider_refresh_token: null,
      };
    } catch (error) {
      console.warn('Safari session retrieval failed:', error);
      return null;
    }
  }

  public clearPersistedSession(): void {
    try {
      const storage = this.getAlternativeStorage();
      storage.removeItem('sb-session-safari');
    } catch (error) {
      console.warn('Safari session cleanup failed:', error);
    }
  }

  public destroy(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }
    this.memoryStorage.clear();
  }

  // ITP (Intelligent Tracking Prevention) workarounds
  public async handleITPRestrictions(): Promise<void> {
    if (!isSafari()) return;

    try {
      // Request storage access if needed (for third-party contexts)
      if ('requestStorageAccess' in document) {
        const hasAccess = await document.hasStorageAccess?.();
        if (!hasAccess) {
          await document.requestStorageAccess?.();
        }
      }
    } catch (error) {
      console.warn('Storage access request failed:', error);
    }
  }
}

// Export singleton instance
export const safariSessionHandler = SafariSessionHandler.getInstance();
