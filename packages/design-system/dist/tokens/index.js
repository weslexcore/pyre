/**
 * Pyre Design System Tokens
 * Main export file for all design tokens
 */
export * from './colors.js';
export * from './typography.js';
export * from './spacing.js';
// Re-export commonly used tokens for convenience
import { colors, darkColors } from './colors.js';
import { fonts, fontSizes, typography } from './typography.js';
import { spacing, radius, layout } from './spacing.js';
export const tokens = {
    colors,
    darkColors,
    fonts,
    fontSizes,
    typography,
    spacing,
    radius,
    layout,
};
export default tokens;
