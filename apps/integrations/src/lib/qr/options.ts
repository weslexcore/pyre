// Turns a stored QrStyle into qr-code-styling options for one rendering:
// the on-page preview, the print-resolution PNG, or the SVG. Client-side
// only: it inlines the Pyre mark as a data URL for the center logo.
//
// qr-code-styling takes a pixel width and a pixel margin, fits whole modules
// inside `width - 2 * margin`, and centers the leftover — so the border it
// draws only moves when the module size steps. Given the module count we
// instead pick an integer module size and hand it a width that is exactly
// `(modules + 2 * quietZone) * moduleSize`, so the quiet zone lands on the
// module and the code is crisp at any export size.

import type { Options as QrCodeStylingOptions } from 'qr-code-styling';
import pyreLogoRaw from '@/assets/pyre_logo.svg?raw';
import type { QrStyle } from './style';

/** On-page preview edge, in px. */
export const PREVIEW_PX = 240;
/** PNG export edge, in px — 4 inches at 300 dpi, enough for a poster. */
export const PNG_PX = 1200;
/** SVG user units per module. Any number works; 10 keeps coordinates tidy. */
export const SVG_MODULE_UNITS = 10;

// A typical short-URL code at error level H is 29 modules; used only for the
// first draw, before the real count is known.
const ASSUMED_MODULES = 29;

// The Pyre mark uses fill="currentColor"; recolor it to `color` and inline it as
// a data URL so qr-code-styling can drop it in the center.
function pyreLogoDataUrl(color: string): string {
  const svg = pyreLogoRaw.replace(/currentColor/g, color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TRANSPARENT = 'rgba(0,0,0,0)';

export interface QrRender {
  type: 'canvas' | 'svg';
  /** Target edge in px (canvas) or user units (svg). */
  target: number;
  /** Module count, once known from a first draw; null to approximate. */
  modules: number | null;
}

/** Exact geometry for a render: integer module size, width, and margin. */
export function qrGeometry(
  quietZone: number,
  render: QrRender
): { moduleSize: number; width: number; margin: number } {
  const modules = render.modules ?? ASSUMED_MODULES;
  const span = modules + 2 * quietZone;
  const moduleSize = Math.max(1, Math.floor(render.target / span));
  return { moduleSize, width: moduleSize * span, margin: moduleSize * quietZone };
}

export function buildQrOptions(
  url: string,
  style: QrStyle,
  render: QrRender
): QrCodeStylingOptions {
  const { width, margin } = qrGeometry(style.quietZone, render);
  return {
    width,
    height: width,
    type: render.type,
    data: url,
    margin,
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
