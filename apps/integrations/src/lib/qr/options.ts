// Turns a stored QrStyle into qr-code-styling options. Client-side only: it
// inlines the Pyre mark as a data URL for the center logo.

import type { Options as QrCodeStylingOptions } from 'qr-code-styling';
import pyreLogoRaw from '@/assets/pyre_logo.svg?raw';
import type { QrStyle } from './style';

// The Pyre mark uses fill="currentColor"; recolor it to `color` and inline it as
// a data URL so qr-code-styling can drop it in the center.
function pyreLogoDataUrl(color: string): string {
  const svg = pyreLogoRaw.replace(/currentColor/g, color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
