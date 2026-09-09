// QR appearance for a campaign link. Each link stores its own style as a JSON
// string on the link record (the shared store only round-trips it); this
// module owns the shape, the defaults, and the validation both the API and
// the island run it through. Pure: no DOM, no assets — buildQrOptions lives
// in ./options so the server never imports the logo.

export type DotType = 'square' | 'dots' | 'rounded' | 'extra-rounded' | 'classy' | 'classy-rounded';
export type CornerSquareType = 'square' | 'dot' | 'extra-rounded';
export type CornerDotType = 'square' | 'dot';

export interface QrStyle {
  dark: string;
  light: string;
  transparent: boolean;
  dotType: DotType;
  cornerSquareType: CornerSquareType;
  cornerDotType: CornerDotType;
  size: number;
  margin: number;
  logo: boolean;
}

export const DOT_TYPES: DotType[] = [
  'square',
  'dots',
  'rounded',
  'extra-rounded',
  'classy',
  'classy-rounded',
];
export const CORNER_SQUARE_TYPES: CornerSquareType[] = ['square', 'dot', 'extra-rounded'];
export const CORNER_DOT_TYPES: CornerDotType[] = ['square', 'dot'];

export const SIZE_RANGE = { min: 120, max: 600 } as const;
export const MARGIN_RANGE = { min: 0, max: 40 } as const;

// Pyre brand palette (hex from src/styles/global.css). Offered as one-click
// swatches for the QR dot and background colors.
export const PYRE_COLORS: Array<{ name: string; hex: string }> = [
  { name: 'Black', hex: '#23221c' },
  { name: 'Creme', hex: '#f5f1e9' },
  { name: 'Red', hex: '#d15232' },
  { name: 'Blue', hex: '#274868' },
  { name: 'Gold', hex: '#dbb155' },
  { name: 'Sage', hex: '#839770' },
  { name: 'Sky', hex: '#3991b7' },
  { name: 'Burnt orange', hex: '#cb6b34' },
];

export const DEFAULT_QR_STYLE: QrStyle = {
  dark: '#23221c', // Pyre black
  light: '#f5f1e9', // Pyre creme
  transparent: false,
  dotType: 'classy-rounded',
  cornerSquareType: 'extra-rounded',
  cornerDotType: 'dot',
  size: 240,
  margin: 8,
  logo: true,
};

const HEX = /^#[0-9a-f]{6}$/i;

function hex(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null;
}

function bool(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === 'boolean' ? value : null;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T | null {
  if (value === undefined) return fallback;
  return options.includes(value as T) ? (value as T) : null;
}

function int(value: unknown, range: { min: number; max: number }, fallback: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
    ? value
    : null;
}

/**
 * A style off the wire or out of storage. Unknown fields are dropped and
 * missing ones take the default (so a row saved before a field existed still
 * parses); a present-but-wrong field fails the whole thing, because a bad
 * color or size would throw inside the renderer.
 */
export function parseQrStyle(raw: unknown): QrStyle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_QR_STYLE;

  const dark = hex(r.dark, d.dark);
  const light = hex(r.light, d.light);
  const transparent = bool(r.transparent, d.transparent);
  const dotType = oneOf(r.dotType, DOT_TYPES, d.dotType);
  const cornerSquareType = oneOf(r.cornerSquareType, CORNER_SQUARE_TYPES, d.cornerSquareType);
  const cornerDotType = oneOf(r.cornerDotType, CORNER_DOT_TYPES, d.cornerDotType);
  const size = int(r.size, SIZE_RANGE, d.size);
  const margin = int(r.margin, MARGIN_RANGE, d.margin);
  const logo = bool(r.logo, d.logo);

  if (
    dark === null ||
    light === null ||
    transparent === null ||
    dotType === null ||
    cornerSquareType === null ||
    cornerDotType === null ||
    size === null ||
    margin === null ||
    logo === null
  ) {
    return null;
  }
  return { dark, light, transparent, dotType, cornerSquareType, cornerDotType, size, margin, logo };
}

/** The style stored on a link record: '' or unparseable means the default. */
export function qrStyleOf(serialized: string): QrStyle {
  if (!serialized) return DEFAULT_QR_STYLE;
  try {
    return parseQrStyle(JSON.parse(serialized)) ?? DEFAULT_QR_STYLE;
  } catch {
    return DEFAULT_QR_STYLE;
  }
}

export function serializeQrStyle(style: QrStyle): string {
  return JSON.stringify(style);
}
