import { describe, expect, it } from 'vitest';
import { safeReturnUrl, withReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('keeps local admin and form paths', () => {
    expect(safeReturnUrl('/admin')).toBe('/admin');
    expect(safeReturnUrl('/admin/water?day=2')).toBe('/admin/water?day=2');
    expect(safeReturnUrl('/forms/incident')).toBe('/forms/incident');
  });

  it('falls back to /admin for anything else', () => {
    expect(safeReturnUrl(null)).toBe('/admin');
    expect(safeReturnUrl('')).toBe('/admin');
    expect(safeReturnUrl('https://evil.example/admin')).toBe('/admin');
    expect(safeReturnUrl('//evil.example/admin')).toBe('/admin');
    expect(safeReturnUrl('/administrator')).toBe('/admin');
    expect(safeReturnUrl('/set-password')).toBe('/admin');
  });
});

describe('withReturnUrl', () => {
  it('appends a sanitized returnUrl after the extra params', () => {
    expect(withReturnUrl('/', '/admin/water', { step: 'password', email: 'a@b.co' })).toBe(
      '/?step=password&email=a%40b.co&returnUrl=%2Fadmin%2Fwater'
    );
    expect(withReturnUrl('/set-password', 'https://evil.example')).toBe(
      '/set-password?returnUrl=%2Fadmin'
    );
  });
});
