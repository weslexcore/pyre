import { describe, expect, it } from 'vitest';
import { normalizePins, repositionPin, togglePin } from './pinOrder';

const VALID = ['/admin/water', '/admin/sops', '/admin/schedule', '/admin/email'];

describe('normalizePins', () => {
  it('preserves pin order for known hrefs', () => {
    expect(normalizePins(['/admin/sops', '/admin/water'], VALID)).toEqual([
      '/admin/sops',
      '/admin/water',
    ]);
  });

  it('drops hrefs not in the valid list (revoked or removed tools)', () => {
    expect(normalizePins(['/admin/sops', '/admin/gone', '/admin/water'], VALID)).toEqual([
      '/admin/sops',
      '/admin/water',
    ]);
  });

  it('dedupes, keeping the first occurrence', () => {
    expect(normalizePins(['/admin/water', '/admin/sops', '/admin/water'], VALID)).toEqual([
      '/admin/water',
      '/admin/sops',
    ]);
  });

  it('returns empty for empty input', () => {
    expect(normalizePins([], VALID)).toEqual([]);
  });
});

describe('repositionPin', () => {
  const pins = ['/admin/water', '/admin/sops', '/admin/schedule'];

  it('dragging downward lands after the target', () => {
    expect(repositionPin(pins, '/admin/water', '/admin/schedule')).toEqual([
      '/admin/sops',
      '/admin/schedule',
      '/admin/water',
    ]);
  });

  it('dragging upward lands before the target', () => {
    expect(repositionPin(pins, '/admin/schedule', '/admin/water')).toEqual([
      '/admin/schedule',
      '/admin/water',
      '/admin/sops',
    ]);
  });

  it('dropping on itself is a no-op', () => {
    expect(repositionPin(pins, '/admin/sops', '/admin/sops')).toBe(pins);
  });

  it('unknown drag or target is a no-op', () => {
    expect(repositionPin(pins, '/admin/gone', '/admin/sops')).toBe(pins);
    expect(repositionPin(pins, '/admin/sops', '/admin/gone')).toBe(pins);
  });

  it('does not mutate the input array', () => {
    repositionPin(pins, '/admin/water', '/admin/schedule');
    expect(pins).toEqual(['/admin/water', '/admin/sops', '/admin/schedule']);
  });
});

describe('togglePin', () => {
  it('appends an absent href to the end', () => {
    expect(togglePin(['/admin/water'], '/admin/sops')).toEqual(['/admin/water', '/admin/sops']);
  });

  it('removes a present href, keeping the rest in order', () => {
    expect(togglePin(['/admin/water', '/admin/sops', '/admin/email'], '/admin/sops')).toEqual([
      '/admin/water',
      '/admin/email',
    ]);
  });
});
