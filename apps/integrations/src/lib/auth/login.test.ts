import { describe, expect, it } from 'vitest';
import {
  isUnknownUserError,
  loginRedirect,
  rememberReturnUrl,
  safeReturnUrl,
  takeReturnUrl,
} from './login';

function fakeCookies() {
  const jar = new Map<string, string>();
  const options: Record<string, unknown>[] = [];
  return {
    jar,
    options,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, opts?: Record<string, unknown>) => {
      jar.set(name, value);
      if (opts) options.push(opts);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  };
}

describe('safeReturnUrl', () => {
  it('keeps admin and form paths and rejects everything else', () => {
    expect(safeReturnUrl('/admin/water?week=1')).toBe('/admin/water?week=1');
    expect(safeReturnUrl('/forms/wishlist')).toBe('/forms/wishlist');
    expect(safeReturnUrl('/admin')).toBe('/admin');
    expect(safeReturnUrl('/administrator')).toBe('/admin');
    expect(safeReturnUrl('https://evil.test/admin')).toBe('/admin');
    expect(safeReturnUrl('//evil.test')).toBe('/admin');
    expect(safeReturnUrl(null)).toBe('/admin');
    expect(safeReturnUrl(undefined)).toBe('/admin');
  });
});

describe('return url cookie', () => {
  it('remembers a safe destination and clears it when read', () => {
    const cookies = fakeCookies();
    rememberReturnUrl(cookies as never, '/admin/sops');
    expect(cookies.options[0]).toMatchObject({ httpOnly: true, path: '/', maxAge: 600 });
    expect(takeReturnUrl(cookies as never)).toBe('/admin/sops');
    expect(cookies.jar.size).toBe(0);
    expect(takeReturnUrl(cookies as never)).toBe('/admin');
  });

  it('never stores an unsafe destination', () => {
    const cookies = fakeCookies();
    rememberReturnUrl(cookies as never, 'https://evil.test');
    expect(takeReturnUrl(cookies as never)).toBe('/admin');
  });
});

describe('isUnknownUserError', () => {
  it('recognises the closed-sign-up answer and nothing else', () => {
    expect(
      isUnknownUserError({ code: 'otp_disabled', message: 'Signups not allowed for otp' })
    ).toBe(true);
    expect(isUnknownUserError({ message: 'Signups not allowed for otp' })).toBe(true);
    expect(isUnknownUserError({ code: 'over_email_send_rate_limit', message: 'rate limit' })).toBe(
      false
    );
  });
});

describe('loginRedirect', () => {
  it('carries the destination and the error code', () => {
    expect(loginRedirect('/admin/water', 'link_expired')).toBe(
      '/?returnUrl=%2Fadmin%2Fwater&error=link_expired'
    );
    expect(loginRedirect('/admin')).toBe('/?returnUrl=%2Fadmin');
  });
});
