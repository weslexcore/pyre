/**
 * Pyre Design System Tailwind Preset
 * Shared configuration for both Astro and Next.js apps
 */

// Note: tailwindcss is a peer dependency, so we'll define the Config type inline
type Config = {
  theme?: {
    extend?: Record<string, any>;
    [key: string]: any;
  };
  plugins?: any[];
  [key: string]: any;
};
import { fontFamilyVars, fontSizes } from '../tokens/typography.js';
import { colors } from '../tokens/colors.js';
import { spacing, radius } from '../tokens/spacing.js';

export const pyrePreset: Partial<Config> = {
  theme: {
    extend: {
      // Pyre brand colors
      colors: {
        // Brand colors
        'pyre-black': 'oklch(0.2509 0.0111 99.35)',
        'pyre-creme': 'oklch(0.959 0.0115 84.58)', 
        'pyre-red': 'oklch(0.65 0.18 25)',
        'pyre-blue': 'oklch(0.35 0.12 220)',
        
        // Design system colors using CSS variables
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        chart: {
          '1': 'var(--chart-1)',
          '2': 'var(--chart-2)',
          '3': 'var(--chart-3)',
          '4': 'var(--chart-4)',
          '5': 'var(--chart-5)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
      },
      
      // Pyre typography
      fontFamily: {
        logo: fontFamilyVars.logo,
        mono: fontFamilyVars.mono,
        sans: fontFamilyVars.sans,
        'mono-bold': fontFamilyVars.monoBold,
      },
      
      // Golden ratio font sizes
      fontSize: fontSizes,
      
      // Border radius using design system
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      
      // Consistent spacing
      spacing: spacing,
    },
  },
  plugins: [],
};

export default pyrePreset;