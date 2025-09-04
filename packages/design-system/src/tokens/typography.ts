/**
 * Pyre Typography System
 * Extracted from the Astro site's fonts.ts and global.css
 */

export const fonts = {
  primary: {
    regular: 'PPNeueMontreal-Regular',
    semibold: 'PPNeueMontreal-SemiBold',
  },
  mono: {
    regular: 'PPNeueMontreal-Mono',
    bold: 'PPFraktionMono-Bold',
  },
  logo: 'Eckmannpsych-Small',
} as const;

export const fontWeights = {
  regular: 400,
  semibold: 600,
  bold: 700,
} as const;

// Golden Ratio Type Scale (1:1.618)
const goldenRatio = 1.618;

export const fontSizes = {
  // Base scale using golden ratio
  xs: '0.75rem',     // 12px
  sm: '0.875rem',    // 14px
  base: '1rem',      // 16px - base size
  lg: '1.125rem',    // 18px
  xl: '1.25rem',     // 20px
  '2xl': '1.5rem',   // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem',  // 36px
  '5xl': '3rem',     // 48px
  '6xl': '3.75rem',  // 60px
  '7xl': '4.5rem',   // 72px
  '8xl': '6rem',     // 96px
  '9xl': '8rem',     // 128px

  // Golden ratio scale (base * 1.618^n)
  'scale-1': '1rem',      // base
  'scale-2': '1.618rem',  // base * 1.618^1
  'scale-3': '2.618rem',  // base * 1.618^2
  'scale-4': '4.236rem',  // base * 1.618^3
  'scale-5': '6.854rem',  // base * 1.618^4
  'scale-6': '11.09rem',  // base * 1.618^5
} as const;

export const fontFallbacks = {
  primary: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
  logo: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const;

export const fontFamilyVars = {
  logo: `"${fonts.logo}", ${fontFallbacks.logo}`,
  mono: `"${fonts.mono.regular}", ${fontFallbacks.mono}`,
  sans: `"${fonts.primary.regular}", ${fontFallbacks.primary}`,
  monoBold: `"${fonts.mono.bold}", ${fontFallbacks.mono}`,
} as const;

export const typography = {
  // Font family utilities
  fontFamily: {
    primary: 'var(--font-sans)',
    mono: 'var(--font-mono)',
    logo: 'var(--font-logo)',
    monoBold: 'var(--font-mono-bold)',
  },

  // Font weight utilities
  fontWeight: {
    regular: 400,
    semibold: 600,
    bold: 700,
  },

  // Line height utilities
  lineHeight: {
    tight: 1.2,
    normal: 1.6,
    relaxed: 1.8,
  },

  // Letter spacing (kerning) utilities
  letterSpacing: {
    tight: '-0.02em',
    normal: '0em',
    loose: '0.02em',
    variable: '0.01em',
  },
} as const;

/**
 * Kerning calculation functions
 * Extracted from the original Astro site
 */
export function calculateKerning(fontFamily: string, fontSize: number): number {
  if (fontFamily === 'PPNeueMontreal' || fontFamily === 'var(--font-sans)') {
    if (fontSize > 200) return -40;
    if (fontSize >= 20) return -20;
    return 50; // Deterministic value instead of random
  }
  if (fontFamily === 'PPFraktionMono' || fontFamily === 'var(--font-mono)') {
    if (fontSize > 20) return -20;
    return 100; // Deterministic value instead of random
  }
  return 0;
}

/**
 * Golden ratio type scale calculation
 */
export function calculateTypeScale(baseSize: number, scale: number): number {
  return baseSize * goldenRatio ** scale;
}

/**
 * High contrast typography utilities for dramatic effect
 */
export const dramaticTypography = {
  // Dramatic scale classes
  'text-dramatic': {
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: typography.letterSpacing.tight,
    lineHeight: typography.lineHeight.tight,
  },

  // Hero typography
  'text-hero': {
    fontSize: fontSizes['scale-4'],
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: typography.letterSpacing.tight,
    lineHeight: typography.lineHeight.tight,
  },

  // Display typography
  'text-display': {
    fontSize: fontSizes['scale-5'],
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: typography.letterSpacing.tight,
    lineHeight: typography.lineHeight.tight,
  },
} as const;