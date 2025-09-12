'use client';

import { authEventManager } from './auth-events';
import { createClient } from './client';
import type { Session } from '@supabase/supabase-js';

export interface SessionTimeoutConfig {
  warningThresholdMinutes: number;
  checkIntervalMs: number;
  autoRefreshEnabled: boolean;
  showWarningNotifications: boolean;
  enableIdleDetection: boolean;
  idleTimeoutMinutes: number;
}

export interface TimeoutWarning {
  type: 'expiring' | 'idle' | 'expired';
  timeRemaining: number;
  recommendedAction: 'refresh' | 'login' | 'continue_session';
  message: string;
}

export class SessionTimeoutManager {
  private static instance: SessionTimeoutManager;
  private timeoutCheckInterval: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivityTime = Date.now();
  private isIdleWarningShown = false;
  private callbacks = new Set<(warning: TimeoutWarning) => void>();

  private constructor(private config: SessionTimeoutConfig) {
    this.initializeTimeoutManagement();
  }

  static getInstance(config?: Partial<SessionTimeoutConfig>): SessionTimeoutManager {
    const defaultConfig: SessionTimeoutConfig = {
      warningThresholdMinutes: 5,
      checkIntervalMs: 30000, // 30 seconds
      autoRefreshEnabled: true,
      showWarningNotifications: true,
      enableIdleDetection: true,
      idleTimeoutMinutes: 15,
    };

    if (!SessionTimeoutManager.instance) {
      SessionTimeoutManager.instance = new SessionTimeoutManager({
        ...defaultConfig,
        ...config,
      });
    }
    return SessionTimeoutManager.instance;
  }

  private initializeTimeoutManagement() {
    if (typeof window === 'undefined') return;

    // Start timeout checking
    this.startTimeoutCheck();

    // Set up idle detection
    if (this.config.enableIdleDetection) {
      this.initializeIdleDetection();
    }

    // Listen for auth state changes
    authEventManager.subscribe((state) => {
      if (!state.session) {
        this.stopTimeoutCheck();
        this.stopIdleDetection();
      } else {
        this.startTimeoutCheck();
        this.resetIdleTimer();
      }
    });
  }

  private startTimeoutCheck() {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
    }

    this.timeoutCheckInterval = setInterval(() => {
      this.checkSessionTimeout();
    }, this.config.checkIntervalMs);
  }

  private stopTimeoutCheck() {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = null;
    }
  }

  private async checkSessionTimeout() {
    const authState = authEventManager.getCurrentState();
    const session = authState.session;

    if (!session || !session.expires_at) return;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at;
    const timeToExpiry = expiresAt - now;
    const warningThreshold = this.config.warningThresholdMinutes * 60;

    // Session expired
    if (timeToExpiry <= 0) {
      this.handleSessionExpired();
      return;
    }

    // Session expiring soon
    if (timeToExpiry <= warningThreshold) {
      await this.handleSessionExpiring(session, timeToExpiry);
    }
  }

  private async handleSessionExpiring(_session: Session, timeRemaining: number) {
    const warning: TimeoutWarning = {
      type: 'expiring',
      timeRemaining,
      recommendedAction: this.config.autoRefreshEnabled ? 'refresh' : 'login',
      message: `Your session will expire in ${Math.floor(timeRemaining / 60)} minutes`,
    };

    // Attempt auto-refresh if enabled
    if (this.config.autoRefreshEnabled) {
      try {
        await this.refreshSession();
        console.log('Session auto-refreshed successfully');
        return;
      } catch (error) {
        console.warn('Auto-refresh failed:', error);
        warning.recommendedAction = 'login';
        warning.message = 'Session will expire soon and auto-refresh failed. Please log in again.';
      }
    }

    this.notifyTimeoutWarning(warning);
  }

  private handleSessionExpired() {
    const warning: TimeoutWarning = {
      type: 'expired',
      timeRemaining: 0,
      recommendedAction: 'login',
      message: 'Your session has expired. Please log in again.',
    };

    // Clear the expired session
    this.clearExpiredSession();
    this.notifyTimeoutWarning(warning);
  }

  private async refreshSession(): Promise<boolean> {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.refreshSession();

      if (error || !data.session) {
        throw error || new Error('No session returned');
      }

      console.log('Session refreshed successfully');
      return true;
    } catch (error) {
      console.error('Session refresh failed:', error);
      return false;
    }
  }

  private clearExpiredSession() {
    // This will be handled by Supabase auth state listener
    // Just ensure we clean up our internal state
    this.stopTimeoutCheck();
    this.stopIdleDetection();
  }

  private initializeIdleDetection() {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

    const resetActivity = () => {
      this.lastActivityTime = Date.now();
      this.isIdleWarningShown = false;
      this.resetIdleTimer();
    };

    events.forEach((event) => {
      document.addEventListener(event, resetActivity, true);
    });

    this.resetIdleTimer();
  }

  private resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    const idleTimeoutMs = this.config.idleTimeoutMinutes * 60 * 1000;

    this.idleTimer = setTimeout(() => {
      this.handleIdleTimeout();
    }, idleTimeoutMs);
  }

  private handleIdleTimeout() {
    if (this.isIdleWarningShown) return;

    const authState = authEventManager.getCurrentState();
    if (!authState.session) return;

    this.isIdleWarningShown = true;

    const warning: TimeoutWarning = {
      type: 'idle',
      timeRemaining: this.config.idleTimeoutMinutes * 60,
      recommendedAction: 'continue_session',
      message: `You've been idle for ${this.config.idleTimeoutMinutes} minutes. Your session may be at risk.`,
    };

    this.notifyTimeoutWarning(warning);
  }

  private stopIdleDetection() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.isIdleWarningShown = false;
  }

  private notifyTimeoutWarning(warning: TimeoutWarning) {
    if (!this.config.showWarningNotifications) return;

    this.callbacks.forEach((callback) => {
      try {
        callback(warning);
      } catch (error) {
        console.error('Error in timeout warning callback:', error);
      }
    });
  }

  // Public API
  public onTimeoutWarning(callback: (warning: TimeoutWarning) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  public async manualRefresh(): Promise<boolean> {
    try {
      const result = await this.refreshSession();
      if (result) {
        this.resetIdleTimer();
      }
      return result;
    } catch (error) {
      console.error('Manual session refresh failed:', error);
      return false;
    }
  }

  public extendSession(): void {
    this.lastActivityTime = Date.now();
    this.isIdleWarningShown = false;
    this.resetIdleTimer();
  }

  public getSessionTimeRemaining(): number | null {
    const authState = authEventManager.getCurrentState();
    const session = authState.session;

    if (!session || !session.expires_at) return null;

    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, session.expires_at - now);
  }

  public getIdleTime(): number {
    return Date.now() - this.lastActivityTime;
  }

  public isSessionExpiringSoon(): boolean {
    const remaining = this.getSessionTimeRemaining();
    if (remaining === null) return false;

    const warningThreshold = this.config.warningThresholdMinutes * 60;
    return remaining <= warningThreshold;
  }

  public destroy(): void {
    this.stopTimeoutCheck();
    this.stopIdleDetection();
    this.callbacks.clear();
  }

  // Configuration updates
  public updateConfig(config: Partial<SessionTimeoutConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart with new config
    this.stopTimeoutCheck();
    this.stopIdleDetection();
    this.initializeTimeoutManagement();
  }
}

// Export singleton instance
export const sessionTimeoutManager = SessionTimeoutManager.getInstance();
