/**
 * Pyre Typography System
 * Extracted from the Astro site's fonts.ts and global.css
 */
export declare const fonts: {
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
export declare const fontWeights: {
    readonly regular: 400;
    readonly semibold: 600;
    readonly bold: 700;
};
export declare const fontSizes: {
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
export declare const fontFallbacks: {
    readonly primary: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif";
    readonly mono: "ui-monospace, SFMono-Regular, \"SF Mono\", Consolas, \"Liberation Mono\", Menlo, monospace";
    readonly logo: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif";
};
export declare const fontFamilyVars: {
    readonly logo: "\"Eckmannpsych-Small\", system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif";
    readonly mono: "\"PPNeueMontreal-Mono\", ui-monospace, SFMono-Regular, \"SF Mono\", Consolas, \"Liberation Mono\", Menlo, monospace";
    readonly sans: "\"PPNeueMontreal-Regular\", system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif";
    readonly monoBold: "\"PPFraktionMono-Bold\", ui-monospace, SFMono-Regular, \"SF Mono\", Consolas, \"Liberation Mono\", Menlo, monospace";
};
export declare const typography: {
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
/**
 * Kerning calculation functions
 * Extracted from the original Astro site
 */
export declare function calculateKerning(fontFamily: string, fontSize: number): number;
/**
 * Golden ratio type scale calculation
 */
export declare function calculateTypeScale(baseSize: number, scale: number): number;
/**
 * High contrast typography utilities for dramatic effect
 */
export declare const dramaticTypography: {
    readonly 'text-dramatic': {
        readonly fontWeight: 600;
        readonly letterSpacing: "-0.02em";
        readonly lineHeight: 1.2;
    };
    readonly 'text-hero': {
        readonly fontSize: "4.236rem";
        readonly fontWeight: 600;
        readonly letterSpacing: "-0.02em";
        readonly lineHeight: 1.2;
    };
    readonly 'text-display': {
        readonly fontSize: "6.854rem";
        readonly fontWeight: 600;
        readonly letterSpacing: "-0.02em";
        readonly lineHeight: 1.2;
    };
};
