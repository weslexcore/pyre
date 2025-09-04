/**
 * Pyre Design System Tokens
 * Main export file for all design tokens
 */
export * from './colors.js';
export * from './typography.js';
export * from './spacing.js';
export declare const tokens: {
    readonly colors: {
        readonly pyre: {
            readonly black: "oklch(0.2509 0.0111 99.35)";
            readonly creme: "oklch(0.959 0.0115 84.58)";
            readonly red: "oklch(0.65 0.18 25)";
            readonly blue: "oklch(0.35 0.12 220)";
        };
        readonly background: "var(--pyre-creme)";
        readonly foreground: "var(--pyre-black)";
        readonly card: "var(--pyre-creme)";
        readonly cardForeground: "var(--pyre-black)";
        readonly popover: "var(--pyre-creme)";
        readonly popoverForeground: "var(--pyre-black)";
        readonly primary: "var(--pyre-red)";
        readonly primaryForeground: "var(--pyre-creme)";
        readonly secondary: "var(--pyre-blue)";
        readonly secondaryForeground: "var(--pyre-creme)";
        readonly muted: "oklch(0.96 0.01 60)";
        readonly mutedForeground: "oklch(0.55 0.01 60)";
        readonly accent: "var(--pyre-black)";
        readonly accentForeground: "var(--pyre-creme)";
        readonly destructive: "var(--pyre-red)";
        readonly border: "oklch(0.92 0.01 60)";
        readonly input: "oklch(0.92 0.01 60)";
        readonly ring: "var(--pyre-red)";
        readonly chart: {
            readonly 1: "var(--pyre-red)";
            readonly 2: "var(--pyre-blue)";
            readonly 3: "var(--pyre-black)";
            readonly 4: "var(--pyre-creme)";
            readonly 5: "oklch(0.65 0.18 25)";
        };
        readonly sidebar: "var(--pyre-creme)";
        readonly sidebarForeground: "var(--pyre-black)";
        readonly sidebarPrimary: "var(--pyre-red)";
        readonly sidebarPrimaryForeground: "var(--pyre-creme)";
        readonly sidebarAccent: "var(--pyre-blue)";
        readonly sidebarAccentForeground: "var(--pyre-creme)";
        readonly sidebarBorder: "oklch(0.92 0.01 60)";
        readonly sidebarRing: "var(--pyre-red)";
    };
    readonly darkColors: {
        readonly background: "var(--pyre-black)";
        readonly foreground: "var(--pyre-creme)";
        readonly card: "oklch(0.216 0.006 56.043)";
        readonly cardForeground: "var(--pyre-creme)";
        readonly popover: "oklch(0.216 0.006 56.043)";
        readonly popoverForeground: "var(--pyre-creme)";
        readonly primary: "var(--pyre-red)";
        readonly primaryForeground: "var(--pyre-black)";
        readonly secondary: "var(--pyre-blue)";
        readonly secondaryForeground: "var(--pyre-creme)";
        readonly muted: "oklch(0.268 0.007 34.298)";
        readonly mutedForeground: "oklch(0.709 0.01 56.259)";
        readonly accent: "var(--pyre-blue)";
        readonly accentForeground: "var(--pyre-creme)";
        readonly destructive: "var(--pyre-red)";
        readonly border: "oklch(1 0 0 / 10%)";
        readonly input: "oklch(1 0 0 / 15%)";
        readonly ring: "var(--pyre-red)";
        readonly chart: {
            readonly 1: "var(--pyre-red)";
            readonly 2: "var(--pyre-blue)";
            readonly 3: "var(--pyre-creme)";
            readonly 4: "var(--pyre-black)";
            readonly 5: "oklch(0.645 0.246 16.439)";
        };
        readonly sidebar: "oklch(0.216 0.006 56.043)";
        readonly sidebarForeground: "var(--pyre-creme)";
        readonly sidebarPrimary: "var(--pyre-red)";
        readonly sidebarPrimaryForeground: "var(--pyre-black)";
        readonly sidebarAccent: "var(--pyre-blue)";
        readonly sidebarAccentForeground: "var(--pyre-creme)";
        readonly sidebarBorder: "oklch(1 0 0 / 10%)";
        readonly sidebarRing: "var(--pyre-red)";
    };
    readonly fonts: {
        readonly primary: {
            readonly regular: "PPNeueMontreal-Regular";
            readonly semibold: "PPNeueMontreal-SemiBold";
        };
        readonly mono: {
            readonly regular: "PPNeueMontreal-Mono";
            readonly bold: "PPFraktionMono-Bold";
        };
        readonly logo: "Eckmannpsych-Small";
    };
    readonly fontSizes: {
        readonly xs: "0.75rem";
        readonly sm: "0.875rem";
        readonly base: "1rem";
        readonly lg: "1.125rem";
        readonly xl: "1.25rem";
        readonly '2xl': "1.5rem";
        readonly '3xl': "1.875rem";
        readonly '4xl': "2.25rem";
        readonly '5xl': "3rem";
        readonly '6xl': "3.75rem";
        readonly '7xl': "4.5rem";
        readonly '8xl': "6rem";
        readonly '9xl': "8rem";
        readonly 'scale-1': "1rem";
        readonly 'scale-2': "1.618rem";
        readonly 'scale-3': "2.618rem";
        readonly 'scale-4': "4.236rem";
        readonly 'scale-5': "6.854rem";
        readonly 'scale-6': "11.09rem";
    };
    readonly typography: {
        readonly fontFamily: {
            readonly primary: "var(--font-sans)";
            readonly mono: "var(--font-mono)";
            readonly logo: "var(--font-logo)";
            readonly monoBold: "var(--font-mono-bold)";
        };
        readonly fontWeight: {
            readonly regular: 400;
            readonly semibold: 600;
            readonly bold: 700;
        };
        readonly lineHeight: {
            readonly tight: 1.2;
            readonly normal: 1.6;
            readonly relaxed: 1.8;
        };
        readonly letterSpacing: {
            readonly tight: "-0.02em";
            readonly normal: "0em";
            readonly loose: "0.02em";
            readonly variable: "0.01em";
        };
    };
    readonly spacing: {
        readonly 0: "0";
        readonly px: "1px";
        readonly 0.5: "0.125rem";
        readonly 1: "0.25rem";
        readonly 1.5: "0.375rem";
        readonly 2: "0.5rem";
        readonly 2.5: "0.625rem";
        readonly 3: "0.75rem";
        readonly 3.5: "0.875rem";
        readonly 4: "1rem";
        readonly 5: "1.25rem";
        readonly 6: "1.5rem";
        readonly 7: "1.75rem";
        readonly 8: "2rem";
        readonly 9: "2.25rem";
        readonly 10: "2.5rem";
        readonly 11: "2.75rem";
        readonly 12: "3rem";
        readonly 14: "3.5rem";
        readonly 16: "4rem";
        readonly 20: "5rem";
        readonly 24: "6rem";
        readonly 28: "7rem";
        readonly 32: "8rem";
        readonly 36: "9rem";
        readonly 40: "10rem";
        readonly 44: "11rem";
        readonly 48: "12rem";
        readonly 52: "13rem";
        readonly 56: "14rem";
        readonly 60: "15rem";
        readonly 64: "16rem";
        readonly 72: "18rem";
        readonly 80: "20rem";
        readonly 96: "24rem";
    };
    readonly radius: {
        readonly sm: "calc(var(--radius) - 4px)";
        readonly md: "calc(var(--radius) - 2px)";
        readonly lg: "var(--radius)";
        readonly xl: "calc(var(--radius) + 4px)";
    };
    readonly layout: {
        readonly radius: "0.625rem";
        readonly containerPadding: {
            readonly sm: "1rem";
            readonly md: "2rem";
            readonly lg: "4rem";
            readonly xl: "6rem";
        };
        readonly maxWidths: {
            readonly xs: "20rem";
            readonly sm: "24rem";
            readonly md: "28rem";
            readonly lg: "32rem";
            readonly xl: "36rem";
            readonly '2xl': "42rem";
            readonly '3xl': "48rem";
            readonly '4xl': "56rem";
            readonly '5xl': "64rem";
            readonly '6xl': "72rem";
            readonly '7xl': "80rem";
            readonly full: "100%";
        };
        readonly breakpoints: {
            readonly sm: "640px";
            readonly md: "768px";
            readonly lg: "1024px";
            readonly xl: "1280px";
            readonly '2xl': "1536px";
        };
    };
};
export default tokens;
