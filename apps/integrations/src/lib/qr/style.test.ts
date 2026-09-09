import { describe, expect, it } from 'vitest';
import { DEFAULT_QR_STYLE, parseQrStyle, qrStyleOf, serializeQrStyle } from './style';

describe('parseQrStyle', () => {
  it('fills missing fields from the default', () => {
    expect(parseQrStyle({})).toEqual(DEFAULT_QR_STYLE);
    expect(parseQrStyle({ dark: '#FF0000' })).toEqual({ ...DEFAULT_QR_STYLE, dark: '#ff0000' });
  });

  it('drops unknown fields', () => {
    const parsed = parseQrStyle({ extra: 1 });
    expect(parsed).toEqual(DEFAULT_QR_STYLE);
    expect(parsed && 'extra' in parsed).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(parseQrStyle(null)).toBeNull();
    expect(parseQrStyle('x')).toBeNull();
    expect(parseQrStyle([])).toBeNull();
  });

  it('rejects a present-but-wrong field', () => {
    expect(parseQrStyle({ dark: 'red' })).toBeNull();
    expect(parseQrStyle({ dark: '#fff' })).toBeNull();
    expect(parseQrStyle({ transparent: 'yes' })).toBeNull();
    expect(parseQrStyle({ dotType: 'hearts' })).toBeNull();
    expect(parseQrStyle({ cornerSquareType: 'round' })).toBeNull();
    expect(parseQrStyle({ cornerDotType: 'star' })).toBeNull();
    expect(parseQrStyle({ quietZone: 9 })).toBeNull();
    expect(parseQrStyle({ quietZone: -1 })).toBeNull();
    expect(parseQrStyle({ quietZone: 2.5 })).toBeNull();
    expect(parseQrStyle({ logo: 1 })).toBeNull();
  });

  it('accepts every valid enum value and the range edges', () => {
    expect(parseQrStyle({ dotType: 'classy', quietZone: 0 })).toMatchObject({
      dotType: 'classy',
      quietZone: 0,
    });
    expect(parseQrStyle({ quietZone: 8 })?.quietZone).toBe(8);
  });

  it('migrates a legacy pixel margin to modules and ignores the old size', () => {
    expect(parseQrStyle({ size: 240, margin: 8 })?.quietZone).toBe(1);
    expect(parseQrStyle({ size: 240, margin: 32 })).toEqual(DEFAULT_QR_STYLE);
    expect(parseQrStyle({ size: 600, margin: 0 })?.quietZone).toBe(0);
    expect(parseQrStyle({ margin: 40 })?.quietZone).toBe(5);
    expect(parseQrStyle({ margin: 400 })?.quietZone).toBe(8);
    expect(parseQrStyle({ size: 240 })).toEqual(DEFAULT_QR_STYLE);
    expect(parseQrStyle({ size: 240 }) && 'size' in (parseQrStyle({ size: 240 }) ?? {})).toBe(
      false
    );
  });
});

describe('qrStyleOf', () => {
  it('round-trips through serialize', () => {
    const style = { ...DEFAULT_QR_STYLE, dark: '#d15232', quietZone: 2, logo: false };
    expect(qrStyleOf(serializeQrStyle(style))).toEqual(style);
  });

  it('falls back to the default for empty or broken strings', () => {
    expect(qrStyleOf('')).toEqual(DEFAULT_QR_STYLE);
    expect(qrStyleOf('{not json')).toEqual(DEFAULT_QR_STYLE);
    expect(qrStyleOf('{"quietZone":"big"}')).toEqual(DEFAULT_QR_STYLE);
  });
});
