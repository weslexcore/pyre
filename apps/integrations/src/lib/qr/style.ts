// QR appearance shared by every code the Campaigns tool renders, persisted
// per-browser so an admin's chosen look sticks between visits. Pure config;
// the qr-code-styling import happens lazily in the QrCode component.

import type { Options as QrCodeStylingOptions } from 'qr-code-styling';
import pyreLogoRaw from '@/assets/pyre_logo.svg?raw';

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

// The Pyre mark uses fill="currentColor"; recolor it to `color` and inline it as
// a data URL so qr-code-styling can drop it in the center.
function pyreLogoDataUrl(color: string): string {
  const svg = pyreLogoRaw.replace(/currentColor/g, color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Kept from the UTM Assist era so saved preferences survive the rework.
const QR_STYLE_KEY = 'pyre-utm-qr-style';

export function loadQrStyle(): QrStyle {
  if (typeof window === 'undefined') return DEFAULT_QR_STYLE;
  try {
    const raw = window.localStorage.getItem(QR_STYLE_KEY);
    if (!raw) return DEFAULT_QR_STYLE;
    return { ...DEFAULT_QR_STYLE, ...(JSON.parse(raw) as Partial<QrStyle>) };
  } catch {
    return DEFAULT_QR_STYLE;
  }
}

export function saveQrStyle(style: QrStyle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QR_STYLE_KEY, JSON.stringify(style));
  } catch {
    // Best-effort persistence.
  }
}

const TRANSPARENT = 'rgba(0,0,0,0)';

export function buildQrOptions(url: string, style: QrStyle): QrCodeStylingOptions {
  return {
    width: style.size,
    height: style.size,
    type: 'canvas',
    data: url,
    margin: style.margin,
    // Highest error correction when a center logo covers part of the code.
    qrOptions: { errorCorrectionLevel: style.logo ? 'H' : 'M' },
    // Recolor the logo to match the dots; empty string clears it on toggle-off.
    image: style.logo ? pyreLogoDataUrl(style.dark) : '',
    imageOptions: { imageSize: 0.3, margin: 4, hideBackgroundDots: true, crossOrigin: 'anonymous' },
    dotsOptions: { color: style.dark, type: style.dotType },
    backgroundOptions: { color: style.transparent ? TRANSPARENT : style.light },
    cornersSquareOptions: { color: style.dark, type: style.cornerSquareType },
    cornersDotOptions: { color: style.dark, type: style.cornerDotType },
  };
}
