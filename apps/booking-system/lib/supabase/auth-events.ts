'use client';

import { createClient } from './client';
import { safariSessionHandler } from './safari-session-handler';
import { isSafari, isWebKit } from './cookie-config';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

export type AuthState = {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated?: number;
};

export type AuthEventCallback = (state: AuthState) => void;

interface CachedAuthState {
  session: Session | null;
  timestamp: number;
  error: string | null;
}

const CACHE_KEY = 'pyre_auth_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export class AuthEventManager {
  private static instance: AuthEventManager;
  private callbacks: Set<AuthEventCallback> = new Set();
  private currentState: AuthState = {
    session: null,
    isLoading: true,
    error: null,
  };
  private subscription: { unsubscribe: () => void } | null = null;

  private constructor() {
    this.loadFromCache();
    this.initializeSubscription();
  }

  static getInstance(): AuthEventManager {
    if (!AuthEventManager.instance) {
      AuthEventManager.instance = new AuthEventManager();
    }
    return AuthEventManager.instance;
  }

  private loadFromCache() {
    if (typeof window === 'undefined') return;

    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return;

      const parsedCache: CachedAuthState = JSON.parse(cached);
      const now = Date.now();

      // Check if cache is still valid
      if (now - parsedCache.timestamp < CACHE_DURATION) {
        this.currentState = {
          session: parsedCache.session,
          isLoading: false,
          error: parsedCache.error,
          lastUpdated: parsedCache.timestamp,
        };
      } else {
        // Cache expired, remove it
        this.clearCache();
      }
    } catch (error) {
      console.warn('Failed to load auth cache:', error);
      this.clearCache();
    }
  }

  private saveToCache(state: AuthState) {
    if (typeof window === 'undefined') return;

    try {
      const cacheData: CachedAuthState = {
        session: state.session,
        timestamp: Date.now(),
        error: state.error,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('Failed to save auth cache:', error);
    }
  }

  private clearCache() {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (error) {
      console.warn('Failed to clear auth cache:', error);
    }
  }

  private async initializeSubscription() {
    const supabase = createClient();

    try {
      // Handle Safari/WebKit-specific session initialization
      if (isSafari() || isWebKit()) {
        await safariSessionHandler.handleITPRestrictions();

        // Try to get persisted session first
        const persistedSession = await safariSessionHandler.getPersistedSession();
        if (persistedSession) {
          this.updateState({
            session: persistedSession,
            isLoading: false,
            error: null,
          });
        }
      }

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        this.updateState({
          session: null,
          isLoading: false,
          error: error.message,
        });
        return;
      }

      this.updateState({
        session,
        isLoading: false,
        error: null,
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(
        async (_event: AuthChangeEvent, session: Session | null) => {
          // Handle Safari-specific session persistence
          if ((isSafari() || isWebKit()) && session) {
            await safariSessionHandler.persistSessionSafely(session);
          } else if (!session && (isSafari() || isWebKit())) {
            safariSessionHandler.clearPersistedSession();
          }

          this.updateState({
            session,
            isLoading: false,
            error: null,
          });
        }
      );

      this.subscription = subscription;
    } catch (error) {
      this.updateState({
        session: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }

  private updateState(newState: AuthState) {
    const stateWithTimestamp = {
      ...newState,
      lastUpdated: Date.now(),
    };

    this.currentState = stateWithTimestamp;

    // Save to cache when auth state changes (but not when loading)
    if (!newState.isLoading) {
      this.saveToCache(stateWithTimestamp);
    }

    this.callbacks.forEach((callback) => {
      callback(stateWithTimestamp);
    });
  }

  subscribe(callback: AuthEventCallback): () => void {
    this.callbacks.add(callback);
    // Immediately call with current state
    callback(this.currentState);

    // Return cleanup function
    return () => {
      this.callbacks.delete(callback);
    };
  }

  getCurrentState(): AuthState {
    return this.currentState;
  }

  invalidateCache() {
    this.clearCache();
  }

  destroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.callbacks.clear();
    this.clearCache();

    // Clean up Safari session handler
    if (isSafari() || isWebKit()) {
      safariSessionHandler.destroy();
    }
  }
}

export const authEventManager = AuthEventManager.getInstance();
