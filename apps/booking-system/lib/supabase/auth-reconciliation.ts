'use client';

import { createClient } from './client';
import { authEventManager } from './auth-events';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthReconciliationResult {
  isConsistent: boolean;
  clientSession: Session | null;
  serverUser: User | null;
  action: 'refresh' | 'sync' | 'none';
  reason?: string;
}

export interface ServerAuthState {
  userId?: string;
  isAuthenticated: boolean;
  userMetadata?: Record<string, unknown>;
}

export class AuthReconciliation {
  private static instance: AuthReconciliation;

  private constructor() {}

  static getInstance(): AuthReconciliation {
    if (!AuthReconciliation.instance) {
      AuthReconciliation.instance = new AuthReconciliation();
    }
    return AuthReconciliation.instance;
  }

  async reconcileAuthState(serverState?: ServerAuthState): Promise<AuthReconciliationResult> {
    const supabase = createClient();
    const clientState = authEventManager.getCurrentState();

    try {
      // Get fresh session from client
      const {
        data: { session: clientSession },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        return {
          isConsistent: false,
          clientSession: null,
          serverUser: null,
          action: 'refresh',
          reason: `Client session error: ${error.message}`,
        };
      }

      // If no server state provided, just validate client consistency
      if (!serverState) {
        const isClientConsistent =
          clientSession?.user?.id === clientState.session?.user?.id &&
          !!clientSession === !!clientState.session;

        return {
          isConsistent: isClientConsistent,
          clientSession,
          serverUser: clientSession?.user || null,
          action: isClientConsistent ? 'none' : 'sync',
          reason: isClientConsistent ? undefined : 'Client state mismatch',
        };
      }

      // Compare client and server states
      const clientUserId = clientSession?.user?.id;
      const serverUserId = serverState.userId;
      const clientAuthenticated = !!clientSession;
      const serverAuthenticated = serverState.isAuthenticated;

      // Check for authentication state mismatch
      if (clientAuthenticated !== serverAuthenticated) {
        return {
          isConsistent: false,
          clientSession,
          serverUser: clientSession?.user || null,
          action: 'refresh',
          reason: `Auth state mismatch: client=${clientAuthenticated}, server=${serverAuthenticated}`,
        };
      }

      // Check for user ID mismatch when both are authenticated
      if (clientAuthenticated && serverAuthenticated && clientUserId !== serverUserId) {
        return {
          isConsistent: false,
          clientSession,
          serverUser: clientSession?.user || null,
          action: 'refresh',
          reason: `User ID mismatch: client=${clientUserId}, server=${serverUserId}`,
        };
      }

      // States are consistent
      return {
        isConsistent: true,
        clientSession,
        serverUser: clientSession?.user || null,
        action: 'none',
      };
    } catch (error) {
      return {
        isConsistent: false,
        clientSession: null,
        serverUser: null,
        action: 'refresh',
        reason: `Reconciliation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async forceRefresh(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  async syncClientWithServer(serverState: ServerAuthState): Promise<boolean> {
    try {
      const supabase = createClient();

      // If server says user is not authenticated, sign out client
      if (!serverState.isAuthenticated) {
        await supabase.auth.signOut();
        return true;
      }

      // If server has user but client doesn't, refresh session
      if (serverState.isAuthenticated && !authEventManager.getCurrentState().session) {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error || !session) {
          // Try to refresh the session
          const { error: refreshError } = await supabase.auth.refreshSession();
          return !refreshError;
        }
      }

      return true;
    } catch (error) {
      console.warn('Auth sync error:', error);
      return false;
    }
  }
}

export const authReconciliation = AuthReconciliation.getInstance();
