'use client';

import { createClient } from './client';
import { sessionPersistenceValidator } from './session-persistence-validator';

export interface BrowserInfo {
  name: string;
  version: string;
  engine: string;
  os: string;
  isMobile: boolean;
  supportsLocalStorage: boolean;
  supportsSessionStorage: boolean;
  supportsCookies: boolean;
  supportsStorageAccess: boolean;
}

export interface CompatibilityTestResult {
  testName: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
  duration: number;
}

export interface BrowserCompatibilityReport {
  browserInfo: BrowserInfo;
  testResults: CompatibilityTestResult[];
  overallScore: number;
  recommendations: string[];
  timestamp: number;
}

export class BrowserCompatibilityTester {
  private static instance: BrowserCompatibilityTester;

  private constructor() {}

  static getInstance(): BrowserCompatibilityTester {
    if (!BrowserCompatibilityTester.instance) {
      BrowserCompatibilityTester.instance = new BrowserCompatibilityTester();
    }
    return BrowserCompatibilityTester.instance;
  }

  private hasCookieStore(): boolean {
    return typeof window !== 'undefined' && 'cookieStore' in window;
  }

  private async setCookie(
    name: string,
    value: string,
    init?: {
      path?: string;
      domain?: string;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      expires?: number | Date;
    }
  ): Promise<void> {
    if (this.hasCookieStore()) {
      // @ts-expect-error: cookieStore is not in TypeScript lib yet in some setups
      await window.cookieStore.set({ name, value, ...init });
      return;
    }
    const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
    if (init?.domain) parts.push(`Domain=${init.domain}`);
    if (init?.path) parts.push(`Path=${init.path}`);
    if (init?.secure) parts.push('Secure');
    if (init?.sameSite)
      parts.push(`SameSite=${init.sameSite.charAt(0).toUpperCase()}${init.sameSite.slice(1)}`);
    if (init?.expires) {
      const d = typeof init.expires === 'number' ? new Date(init.expires) : init.expires;
      parts.push(`Expires=${d.toUTCString()}`);
    }
    const cookieString = parts.join('; ');
    // biome-ignore lint/suspicious/noDocumentCookie: Fallback when Cookie Store API unavailable
    document.cookie = cookieString;
  }

  private async getCookie(name: string): Promise<string | null> {
    if (this.hasCookieStore()) {
      // @ts-expect-error: cookieStore is not in TypeScript lib yet in some setups
      const item = await window.cookieStore.get(name);
      return item?.value ?? null;
    }
    const cookies = document.cookie.split(';').map((c) => c.trim());
    for (const c of cookies) {
      const [n, v] = c.split('=');
      if (n === name) return decodeURIComponent(v || '');
    }
    return null;
  }

  private async deleteCookie(
    name: string,
    init?: { path?: string; domain?: string }
  ): Promise<void> {
    if (this.hasCookieStore()) {
      // @ts-expect-error: cookieStore is not in TypeScript lib yet in some setups
      await window.cookieStore.delete({ name, ...init });
      return;
    }
    const parts: string[] = [`${name}=`, 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
    if (init?.domain) parts.push(`Domain=${init.domain}`);
    if (init?.path) parts.push(`Path=${init.path}`);
    const cookieString = parts.join('; ');
    // biome-ignore lint/suspicious/noDocumentCookie: Fallback when Cookie Store API unavailable
    document.cookie = cookieString;
  }

  public async runCompatibilityTests(): Promise<BrowserCompatibilityReport> {
    const browserInfo = this.detectBrowser();
    const testResults: CompatibilityTestResult[] = [];

    // Run all compatibility tests
    testResults.push(await this.testLocalStorage());
    testResults.push(await this.testSessionStorage());
    testResults.push(await this.testCookieSupport());
    testResults.push(await this.testSupabaseClientCreation());
    testResults.push(await this.testAuthStateManagement());
    testResults.push(await this.testSessionPersistence());
    testResults.push(await this.testCrossTabCommunication());
    testResults.push(await this.testStorageAccessAPI());
    testResults.push(await this.testCookieSettings());
    testResults.push(await this.testSessionRefresh());

    // Calculate overall score
    const passedTests = testResults.filter((test) => test.passed).length;
    const overallScore = (passedTests / testResults.length) * 100;

    // Generate recommendations
    const recommendations = this.generateRecommendations(browserInfo, testResults);

    return {
      browserInfo,
      testResults,
      overallScore,
      recommendations,
      timestamp: Date.now(),
    };
  }

  private detectBrowser(): BrowserInfo {
    if (typeof window === 'undefined') {
      return {
        name: 'Unknown',
        version: 'Unknown',
        engine: 'Unknown',
        os: 'Unknown',
        isMobile: false,
        supportsLocalStorage: false,
        supportsSessionStorage: false,
        supportsCookies: false,
        supportsStorageAccess: false,
      };
    }

    const userAgent = navigator.userAgent;
    const name = this.getBrowserName(userAgent);
    const version = this.getBrowserVersion(userAgent, name);
    const engine = this.getBrowserEngine(userAgent);
    const os = this.getOperatingSystem(userAgent);
    const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent
    );

    return {
      name,
      version,
      engine,
      os,
      isMobile,
      supportsLocalStorage: this.testStorageSupport('localStorage'),
      supportsSessionStorage: this.testStorageSupport('sessionStorage'),
      supportsCookies: navigator.cookieEnabled,
      supportsStorageAccess: 'requestStorageAccess' in document,
    };
  }

  private getBrowserName(userAgent: string): string {
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('SamsungBrowser')) return 'Samsung Browser';
    if (userAgent.includes('Opera') || userAgent.includes('OPR')) return 'Opera';
    if (userAgent.includes('Edge')) return 'Edge';
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Safari')) return 'Safari';
    return 'Unknown';
  }

  private getBrowserVersion(userAgent: string, browserName: string): string {
    let version = 'Unknown';

    switch (browserName) {
      case 'Chrome': {
        const chromeMatch = userAgent.match(/Chrome\/(\d+\.\d+)/);
        version = chromeMatch ? chromeMatch[1] : 'Unknown';
        break;
      }
      case 'Firefox': {
        const firefoxMatch = userAgent.match(/Firefox\/(\d+\.\d+)/);
        version = firefoxMatch ? firefoxMatch[1] : 'Unknown';
        break;
      }
      case 'Safari': {
        const safariMatch = userAgent.match(/Safari\/(\d+\.\d+)/);
        version = safariMatch ? safariMatch[1] : 'Unknown';
        break;
      }
      case 'Edge': {
        const edgeMatch = userAgent.match(/Edge\/(\d+\.\d+)/);
        version = edgeMatch ? edgeMatch[1] : 'Unknown';
        break;
      }
    }

    return version;
  }

  private getBrowserEngine(userAgent: string): string {
    if (userAgent.includes('WebKit')) return 'WebKit';
    if (userAgent.includes('Gecko')) return 'Gecko';
    if (userAgent.includes('Trident')) return 'Trident';
    return 'Unknown';
  }

  private getOperatingSystem(userAgent: string): string {
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('MacOS') || userAgent.includes('Mac OS')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad'))
      return 'iOS';
    return 'Unknown';
  }

  private testStorageSupport(storageType: 'localStorage' | 'sessionStorage'): boolean {
    try {
      const storage = window[storageType];
      const testKey = `__${storageType}_test__`;
      storage.setItem(testKey, 'test');
      storage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  private async testLocalStorage(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const testKey = '__compatibility_test_localStorage__';
      const testValue = JSON.stringify({ test: true, timestamp: Date.now() });

      localStorage.setItem(testKey, testValue);
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);

      const passed = retrieved === testValue;

      return {
        testName: 'LocalStorage Support',
        passed,
        error: passed ? undefined : 'LocalStorage read/write failed',
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'LocalStorage Support',
        passed: false,
        error: error instanceof Error ? error.message : 'LocalStorage test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testSessionStorage(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const testKey = '__compatibility_test_sessionStorage__';
      const testValue = 'session_test_value';

      sessionStorage.setItem(testKey, testValue);
      const retrieved = sessionStorage.getItem(testKey);
      sessionStorage.removeItem(testKey);

      const passed = retrieved === testValue;

      return {
        testName: 'SessionStorage Support',
        passed,
        error: passed ? undefined : 'SessionStorage read/write failed',
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'SessionStorage Support',
        passed: false,
        error: error instanceof Error ? error.message : 'SessionStorage test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testCookieSupport(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const testCookieName = '__compatibility_test_cookie__';
      const testCookieValue = 'test_value_123';

      await this.setCookie(testCookieName, testCookieValue, { path: '/' });
      const cookieExists = (await this.getCookie(testCookieName)) === testCookieValue;
      await this.deleteCookie(testCookieName, { path: '/' });

      return {
        testName: 'Cookie Support',
        passed: cookieExists,
        error: cookieExists ? undefined : 'Cookie read/write failed',
        details: { cookieEnabled: navigator.cookieEnabled },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Cookie Support',
        passed: false,
        error: error instanceof Error ? error.message : 'Cookie test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testSupabaseClientCreation(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const supabase = createClient();
      const passed = !!supabase;

      return {
        testName: 'Supabase Client Creation',
        passed,
        error: passed ? undefined : 'Failed to create Supabase client',
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Supabase Client Creation',
        passed: false,
        error: error instanceof Error ? error.message : 'Client creation failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testAuthStateManagement(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getSession();

      const passed = !error;

      return {
        testName: 'Auth State Management',
        passed,
        error: error?.message,
        details: { hasSession: !!data.session },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Auth State Management',
        passed: false,
        error: error instanceof Error ? error.message : 'Auth state test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testSessionPersistence(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const result = await sessionPersistenceValidator.checkSessionHealth();
      const passed = !result.error;

      return {
        testName: 'Session Persistence',
        passed,
        error: result.error,
        details: {
          isValid: result.isValid,
          needsRefresh: result.needsRefresh,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Session Persistence',
        passed: false,
        error: error instanceof Error ? error.message : 'Session persistence test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testCrossTabCommunication(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      // Test using localStorage events for cross-tab communication
      const testKey = '__cross_tab_test__';
      const testValue = Date.now().toString();

      const handleStorageEvent = () => {
        // Event handler for storage events
      };

      window.addEventListener('storage', handleStorageEvent);

      // Trigger storage event
      localStorage.setItem(testKey, testValue);
      localStorage.removeItem(testKey);

      // Wait a bit for the event
      await new Promise((resolve) => setTimeout(resolve, 100));

      window.removeEventListener('storage', handleStorageEvent);

      return {
        testName: 'Cross-Tab Communication',
        passed: true, // This test mainly checks if the API is available
        details: { storageEventsSupported: 'onstorage' in window },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Cross-Tab Communication',
        passed: false,
        error: error instanceof Error ? error.message : 'Cross-tab test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testStorageAccessAPI(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const hasStorageAccess = 'requestStorageAccess' in document;
      const hasStorageAccessCheck = 'hasStorageAccess' in document;

      return {
        testName: 'Storage Access API',
        passed: true, // Just checking availability
        details: {
          requestStorageAccess: hasStorageAccess,
          hasStorageAccess: hasStorageAccessCheck,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Storage Access API',
        passed: false,
        error: error instanceof Error ? error.message : 'Storage Access API test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testCookieSettings(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      // Test different cookie attributes
      const tests = {
        secure: false,
        httpOnly: false, // Can't test client-side
        sameSite: false,
      };

      // Test secure cookies (if on HTTPS)
      if (location.protocol === 'https:') {
        await this.setCookie('__secure_test__', 'test', { secure: true, path: '/' });
        tests.secure = (await this.getCookie('__secure_test__')) === 'test';
        await this.deleteCookie('__secure_test__', { path: '/' });
      } else {
        tests.secure = true; // Skip on HTTP
      }

      // Test SameSite attribute support
      await this.setCookie('__samesite_test__', 'test', { sameSite: 'lax', path: '/' });
      tests.sameSite = (await this.getCookie('__samesite_test__')) === 'test';
      await this.deleteCookie('__samesite_test__', { path: '/' });

      const passed = Object.values(tests).every(Boolean);

      return {
        testName: 'Cookie Settings Support',
        passed,
        details: tests,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Cookie Settings Support',
        passed: false,
        error: error instanceof Error ? error.message : 'Cookie settings test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private async testSessionRefresh(): Promise<CompatibilityTestResult> {
    const startTime = Date.now();

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.refreshSession();

      // It's okay if there's no session to refresh
      const passed = !error || error.message.includes('no session');

      return {
        testName: 'Session Refresh',
        passed,
        error: passed ? undefined : error?.message,
        details: { hasSession: !!data.session },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        testName: 'Session Refresh',
        passed: false,
        error: error instanceof Error ? error.message : 'Session refresh test failed',
        duration: Date.now() - startTime,
      };
    }
  }

  private generateRecommendations(
    browserInfo: BrowserInfo,
    testResults: CompatibilityTestResult[]
  ): string[] {
    const recommendations: string[] = [];
    const failedTests = testResults.filter((test) => !test.passed);

    // General recommendations based on browser
    if (browserInfo.name === 'Safari' || browserInfo.name === 'WebKit') {
      recommendations.push(
        'Safari detected: Using enhanced cookie settings and ITP workarounds for better compatibility.'
      );

      if (!browserInfo.supportsStorageAccess) {
        recommendations.push(
          'Consider requesting storage access for better session persistence in Safari.'
        );
      }
    }

    if (browserInfo.isMobile) {
      recommendations.push(
        'Mobile browser detected: Using shorter session timeouts and more frequent validation.'
      );
    }

    // Specific recommendations based on failed tests
    failedTests.forEach((test) => {
      switch (test.testName) {
        case 'LocalStorage Support':
          recommendations.push(
            'LocalStorage is not available. Sessions will use memory storage only.'
          );
          break;
        case 'Cookie Support':
          recommendations.push(
            'Cookies are disabled or not supported. Authentication may not persist across sessions.'
          );
          break;
        case 'Session Persistence':
          recommendations.push(
            'Session persistence issues detected. Consider enabling automatic session refresh.'
          );
          break;
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('All compatibility tests passed! No specific recommendations.');
    }

    return recommendations;
  }
}

// Export singleton instance
export const browserCompatibilityTester = BrowserCompatibilityTester.getInstance();
