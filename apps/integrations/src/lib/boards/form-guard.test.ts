import { describe, expect, it } from 'vitest';
import { clientIp, honeypotTripped, MIN_FILL_MS, tooFast } from './form-guard';

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/forms/rentals', { headers });
}

describe('clientIp', () => {
  it('takes the first forwarded hop before anything else', () => {
    expect(
      clientIp(request({ 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1', 'x-real-ip': '9.9.9.9' }))
    ).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip, then the adapter, then unknown', () => {
    expect(clientIp(request({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(clientIp(request(), () => '5.6.7.8')).toBe('5.6.7.8');
    expect(
      clientIp(request(), () => {
        throw new Error('no address');
      })
    ).toBe('unknown');
    expect(clientIp(request())).toBe('unknown');
  });
});

describe('tooFast', () => {
  it('needs a number and a few seconds', () => {
    expect(tooFast(undefined)).toBe(true);
    expect(tooFast('now')).toBe(true);
    expect(tooFast(10_000, 10_000 + MIN_FILL_MS - 1)).toBe(true);
    expect(tooFast(10_000, 10_000 + MIN_FILL_MS)).toBe(false);
  });
});

describe('honeypotTripped', () => {
  it('only fires on text in the hidden field', () => {
    expect(honeypotTripped({})).toBe(false);
    expect(honeypotTripped({ website: '   ' })).toBe(false);
    expect(honeypotTripped({ website: 'http://spam' })).toBe(true);
  });
});
