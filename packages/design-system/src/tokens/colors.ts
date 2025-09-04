/**
 * Pyre Brand Colors
 * These are the core brand colors extracted from the Astro site's global.css
 */
export const colors = {
  // Pyre Brand Colors - RGB to OKLCH Conversion
  pyre: {
    black: 'oklch(0.2509 0.0111 99.35)', // #23221c
    creme: 'oklch(0.959 0.0115 84.58)',  // #f5f1e9
    red: 'oklch(0.65 0.18 25)',          // rgb(241, 88, 54)
    blue: 'oklch(0.35 0.12 220)',        // rgb(36, 90, 130)
  },

  // Design System Colors - Following Pyre 2-Color Rule
  // Primary: Pyre Red + Pyre Creme for CTAs
  // Secondary: Pyre Blue + Pyre Creme for secondary actions
  // Outline: Pyre Black + Pyre Creme for subtle actions
  
  background: 'var(--pyre-creme)',
  foreground: 'var(--pyre-black)',
  
  card: 'var(--pyre-creme)',
  cardForeground: 'var(--pyre-black)',
  
  popover: 'var(--pyre-creme)',
  popoverForeground: 'var(--pyre-black)',
  
  primary: 'var(--pyre-red)',
  primaryForeground: 'var(--pyre-creme)',
  
  secondary: 'var(--pyre-blue)',
  secondaryForeground: 'var(--pyre-creme)',
  
  muted: 'oklch(0.96 0.01 60)',
  mutedForeground: 'oklch(0.55 0.01 60)',
  
  accent: 'var(--pyre-black)',
  accentForeground: 'var(--pyre-creme)',
  
  destructive: 'var(--pyre-red)',
  
  border: 'oklch(0.92 0.01 60)',
  input: 'oklch(0.92 0.01 60)',
  ring: 'var(--pyre-red)',
  
  // Chart colors
  chart: {
    1: 'var(--pyre-red)',
    2: 'var(--pyre-blue)',
    3: 'var(--pyre-black)',
    4: 'var(--pyre-creme)',
    5: 'oklch(0.65 0.18 25)',
  },
  
  // Sidebar colors
  sidebar: 'var(--pyre-creme)',
  sidebarForeground: 'var(--pyre-black)',
  sidebarPrimary: 'var(--pyre-red)',
  sidebarPrimaryForeground: 'var(--pyre-creme)',
  sidebarAccent: 'var(--pyre-blue)',
  sidebarAccentForeground: 'var(--pyre-creme)',
  sidebarBorder: 'oklch(0.92 0.01 60)',
  sidebarRing: 'var(--pyre-red)',
} as const;

/**
 * Dark theme color overrides
 */
export const darkColors = {
  background: 'var(--pyre-black)',
  foreground: 'var(--pyre-creme)',
  
  card: 'oklch(0.216 0.006 56.043)',
  cardForeground: 'var(--pyre-creme)',
  
  popover: 'oklch(0.216 0.006 56.043)',
  popoverForeground: 'var(--pyre-creme)',
  
  primary: 'var(--pyre-red)',
  primaryForeground: 'var(--pyre-black)',
  
  secondary: 'var(--pyre-blue)',
  secondaryForeground: 'var(--pyre-creme)',
  
  muted: 'oklch(0.268 0.007 34.298)',
  mutedForeground: 'oklch(0.709 0.01 56.259)',
  
  accent: 'var(--pyre-blue)',
  accentForeground: 'var(--pyre-creme)',
  
  destructive: 'var(--pyre-red)',
  
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'var(--pyre-red)',
  
  // Chart colors for dark mode
  chart: {
    1: 'var(--pyre-red)',
    2: 'var(--pyre-blue)',
    3: 'var(--pyre-creme)',
    4: 'var(--pyre-black)',
    5: 'oklch(0.645 0.246 16.439)',
  },
  
  // Sidebar colors for dark mode
  sidebar: 'oklch(0.216 0.006 56.043)',
  sidebarForeground: 'var(--pyre-creme)',
  sidebarPrimary: 'var(--pyre-red)',
  sidebarPrimaryForeground: 'var(--pyre-black)',
  sidebarAccent: 'var(--pyre-blue)',
  sidebarAccentForeground: 'var(--pyre-creme)',
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: 'var(--pyre-red)',
} as const;