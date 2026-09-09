// QR appearance for a campaign link. Each link stores its own style as a JSON
// string on the link record (the shared store only round-trips it); this
// module owns the shape, the defaults, and the validation both the API and
// the island run it through. Pure: no DOM, no assets — the renderer options
// live in ./options so the server never imports the logo.
//
// There is no pixel size here on purpose. A QR is a grid of modules; the
// preview draws it small, the PNG export draws it at print resolution, and
// the SVG export has no resolution at all. The quiet zone is therefore in
// modules (the spec's unit — it asks for 4) so it means the same thing at
// every size.

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
  /** Blank border around the code, in modules. */
  quietZone: number;
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

export const QUIET_ZONE_RANGE = { min: 0, max: 8 } as const;

// Styles saved before the quiet zone was measured in modules stored a pixel
// margin on a 240px canvas, where a typical short-URL code has ~8px modules.
const LEGACY_MODULE_PX = 8;

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
  quietZone: 4,
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

function quietZoneOf(r: Record<string, unknown>): number | null {
  if (r.quietZone !== undefined)
    return int(r.quietZone, QUIET_ZONE_RANGE, DEFAULT_QR_STYLE.quietZone);
  // Legacy pixel margin: approximate, and never fail on it — it was valid
  // when it was written.
  if (typeof r.margin === 'number' && Number.isFinite(r.margin)) {
    const modules = Math.round(r.margin / LEGACY_MODULE_PX);
    return Math.min(QUIET_ZONE_RANGE.max, Math.max(QUIET_ZONE_RANGE.min, modules));
  }
  return DEFAULT_QR_STYLE.quietZone;
}

/**
 * A style off the wire or out of storage. Unknown fields are dropped and
 * missing ones take the default (so a row saved before a field existed still
 * parses); a present-but-wrong field fails the whole thing, because a bad
 * color would throw inside the renderer.
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
  const quietZone = quietZoneOf(r);
  const logo = bool(r.logo, d.logo);

  if (
    dark === null ||
    light === null ||
    transparent === null ||
    dotType === null ||
    cornerSquareType === null ||
    cornerDotType === null ||
    quietZone === null ||
    logo === null
  ) {
    return null;
  }
  return { dark, light, transparent, dotType, cornerSquareType, cornerDotType, quietZone, logo };
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
