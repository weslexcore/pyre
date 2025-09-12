/**
 * Minimal tests for auth-events subscription lifecycle using a mocked client.
 */

jest.mock('./client', () => {
  return {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: jest.fn() } },
        }),
      },
    }),
  };
});

import { authEventManager } from './auth-events';
import type { AuthState } from './auth-events';

describe('auth-events', () => {
  test('subscribe immediately receives current state and can unsubscribe', async () => {
    const calls: unknown[] = [];
    const unsubscribe = authEventManager.subscribe((state) => {
      calls.push(state);
    });

    // Wait microtasks for async initialization
    await new Promise((r) => setTimeout(r, 0));

    // Should have at least one call with a state shape
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1] as AuthState;
    expect(last).toHaveProperty('session');
    expect(last).toHaveProperty('isLoading');

    // Unsubscribe should be callable without error
    expect(() => unsubscribe()).not.toThrow();
  });
});
