import type { Config } from 'tailwindcss';

// Import design system preset
let pyrePreset;
try {
  pyrePreset = require('@pyre/design-system/tailwind').pyrePreset;
} catch (e) {
  // Fallback to default configuration if import fails
  console.warn('Could not load @pyre/design-system preset, using default config');
  pyrePreset = {};
}

/** @type {import('tailwindcss').Config} */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1440px',
      },
    },
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
      },
      
      // Pyre typography
      fontFamily: {
        logo: ['Eckmannpsych-Small', 'system-ui', 'sans-serif'],
        mono: ['PPNeueMontreal-Mono', 'system-ui', 'monospace'],
        sans: ['PPNeueMontreal-Regular', 'system-ui', 'sans-serif'],
        'mono-bold': ['PPFraktionMono-Bold', 'ui-monospace', 'monospace'],
      },
      
      // Border radius using design system
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: 'calc(var(--radius) - 4px)',
      },
      
      // Animations
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'spin-slow': {
          '0%': { rotate: '0deg' },
          '100%': { rotate: '360deg' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'spin-slow': 'spin 10s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
