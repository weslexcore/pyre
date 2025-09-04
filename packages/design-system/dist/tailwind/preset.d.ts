/**
 * Pyre Design System Tailwind Preset
 * Shared configuration for both Astro and Next.js apps
 */
type Config = {
    theme?: {
        extend?: Record<string, any>;
        [key: string]: any;
    };
    plugins?: any[];
    [key: string]: any;
};
export declare const pyrePreset: Partial<Config>;
export default pyrePreset;
