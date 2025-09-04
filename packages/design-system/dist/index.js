/**
 * Pyre Design System
 * Main entry point for the design system package
 */
// Export all tokens
export * from './tokens/index.js';
// Export Tailwind preset
export { pyrePreset as default } from './tailwind/preset.js';
export { pyrePreset } from './tailwind/preset.js';
// Re-export for convenience
import { tokens } from './tokens/index.js';
import { pyrePreset } from './tailwind/preset.js';
export const designSystem = {
    tokens,
    tailwind: pyrePreset,
};
