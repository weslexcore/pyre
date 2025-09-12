jest.mock('./client', () => {
  const getSessionMock = jest.fn();
  const refreshSessionMock = jest.fn();
  return {
    __esModule: true,
    createClient: () => ({
      auth: {
        getSession: getSessionMock,
        refreshSession: refreshSessionMock,
      },
    }),
    // Expose mocks for assertions via require
    _mocks: { getSessionMock, refreshSessionMock },
  };
});

jest.mock('./auth-events', () => {
  return {
    authEventManager: {
      getCurrentState: () => ({ session: null, isLoading: false, error: null }),
      subscribe: () => () => {},
    },
  };
});

jest.mock('./session-persistence-validator', () => ({
  sessionPersistenceValidator: {
    checkSessionHealth: jest.fn().mockResolvedValue({
      isValid: true,
      session: {},
      needsRefresh: false,
      validationTimestamp: Date.now(),
    }),
    shouldValidateSession: jest.fn().mockReturnValue(false),
  },
}));

import { sessionValidator } from './session-validator';
import type { Session } from '@supabase/supabase-js';
// Pull mocks (ESM import to satisfy lint rules)
import * as clientModule from './client';

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: 't',
    refresh_token: 'r',
    token_type: 'bearer',
    expires_at: now,
    expires_in: 3600,
    user: { id: 'u1' },
    provider_token: null,
    provider_refresh_token: null,
    ...overrides,
  };
}

describe('session-validator', () => {
  beforeEach(() => {
    clientModule._mocks.getSessionMock.mockReset();
    clientModule._mocks.refreshSessionMock.mockReset();
    sessionValidator.clearCache();
  });

  test('valid when session exists and requireAuth=true', async () => {
    clientModule._mocks.getSessionMock.mockResolvedValueOnce({
      data: { session: makeSession() },
      error: null,
    });

    const res = await sessionValidator.validateSession({ requireAuth: true, cacheKey: 'a' });
    expect(res.isValid).toBe(true);
    expect(res.session?.user?.id).toBe('u1');
  });

  test('invalid when no session and requireAuth=true', async () => {
    clientModule._mocks.getSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    const res = await sessionValidator.validateSession({ requireAuth: true, cacheKey: 'b' });
    expect(res.isValid).toBe(false);
  });

  test('valid when no session and requireAuth=false', async () => {
    clientModule._mocks.getSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    const res = await sessionValidator.validateSession({ requireAuth: false, cacheKey: 'c' });
    expect(res.isValid).toBe(true);
    expect(res.session).toBeNull();
  });

  test('coalesces concurrent validations (single getSession call)', async () => {
    const once = { data: { session: makeSession() }, error: null };
    clientModule._mocks.getSessionMock.mockResolvedValueOnce(once);

    const [r1, r2] = await Promise.all([
      sessionValidator.validateSession({ requireAuth: true, cacheKey: 'same' }),
      sessionValidator.validateSession({ requireAuth: true, cacheKey: 'same' }),
    ]);

    expect(r1.isValid && r2.isValid).toBe(true);
    expect(clientModule._mocks.getSessionMock).toHaveBeenCalledTimes(1);
  });
});
