export type SizeKey =
  | 'square'
  | 'portrait'
  | 'landscape'
  | 'reel'
  | 'story'
  | 'small-menu'
  | 'postcard-4x6'
  | 'business-card'
  | 'letter'
  | 'letter-landscape';

export interface Size {
  w: number;
  h: number;
  label: string;
}

export const SIZES: Record<SizeKey, Size> = {
  square: { w: 1080, h: 1080, label: '1:1' },
  portrait: { w: 1080, h: 1350, label: '4:5' },
  landscape: { w: 1080, h: 566, label: '1.91:1' },
  reel: { w: 1080, h: 1920, label: '9:16' },
  story: { w: 1080, h: 1920, label: '9:16' },
  'small-menu': { w: 1080, h: 1920, label: '9:16' },
  /* Print: 4×6in trim + 0.125in bleed per edge at 300dpi. Content must stay 112px from the canvas edge. */
  'postcard-4x6': { w: 1275, h: 1875, label: '4x6in print' },
  /* Print: 3.5×2in trim + 0.125in bleed per edge at 300dpi. Keep content ≥75px from the canvas edge (37px bleed + cutting tolerance). */
  'business-card': { w: 1125, h: 675, label: '3.5x2in print' },
  /* Print: US Letter (8.5×11in) at 300dpi. Full-sheet menu — keep content within comfortable margins. */
  letter: { w: 2550, h: 3300, label: '8.5x11in print' },
  /* Print: US Letter (8.5×11in) rotated to landscape at 300dpi. Full-sheet sign — keep content within comfortable margins. */
  'letter-landscape': { w: 3300, h: 2550, label: '11x8.5in print' },
};

export const SIZE_KEYS = Object.keys(SIZES) as SizeKey[];
