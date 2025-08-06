export const fonts = {
  primary: {
    regular: 'PPNeueMontreal-Regular',
    semibold: 'PPNeueMontreal-SemiBold',
  },
  mono: {
    bold: 'PPFraktionMono-Bold',
  },
} as const;

export const fontWeights = {
  regular: 400,
  semibold: 600,
  bold: 700,
} as const;

// Golden Ratio Type Scale (1:1.618)
const goldenRatio = 1.618;
const baseSize = 16; // 1rem = 16px

export const fontSizes = {
  // Base scale using golden ratio
  xs: '0.75rem', // 12px
  sm: '0.875rem', // 14px
  base: '1rem', // 16px - base size
  lg: '1.125rem', // 18px
  xl: '1.25rem', // 20px
  '2xl': '1.5rem', // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem', // 36px
  '5xl': '3rem', // 48px
  '6xl': '3.75rem', // 60px
  '7xl': '4.5rem', // 72px
  '8xl': '6rem', // 96px
  '9xl': '8rem', // 128px
  
  // Golden ratio scale (base * 1.618^n)
  'scale-1': '1rem', // base
  'scale-2': '1.618rem', // base * 1.618^1
  'scale-3': '2.618rem', // base * 1.618^2
  'scale-4': '4.236rem', // base * 1.618^3
  'scale-5': '6.854rem', // base * 1.618^4
  'scale-6': '11.09rem', // base * 1.618^5
} as const;

export const fontFallbacks = {
  primary: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
} as const;

// Typography utilities
export const typography = {
  // Font family utilities
  fontFamily: {
    primary: 'var(--font-sans)',
    mono: 'var(--font-mono)',
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

// Kerning calculation functions
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

// Golden ratio type scale calculation
export function calculateTypeScale(baseSize: number, scale: number): number {
  return baseSize * Math.pow(goldenRatio, scale);
}

// Typography class generators
export function generateTypographyClasses() {
  return {
    // Font family classes
    'font-primary': `font-family: ${typography.fontFamily.primary}`,
    'font-mono': `font-family: ${typography.fontFamily.mono}`,
    
    // Font weight classes
    'font-regular': `font-weight: ${typography.fontWeight.regular}`,
    'font-semibold': `font-weight: ${typography.fontWeight.semibold}`,
    'font-bold': `font-weight: ${typography.fontWeight.bold}`,
    
    // Line height classes
    'leading-tight': `line-height: ${typography.lineHeight.tight}`,
    'leading-normal': `line-height: ${typography.lineHeight.normal}`,
    'leading-relaxed': `line-height: ${typography.lineHeight.relaxed}`,
    
    // Letter spacing classes
    'tracking-tight': `letter-spacing: ${typography.letterSpacing.tight}`,
    'tracking-normal': `letter-spacing: ${typography.letterSpacing.normal}`,
    'tracking-loose': `letter-spacing: ${typography.letterSpacing.loose}`,
    'tracking-variable': `letter-spacing: ${typography.letterSpacing.variable}`,
  };
}

// High contrast typography utilities
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