/**
 * Shader configuration presets for @paper-design/shaders
 *
 * Centralizes shader uniform values following the copy-config pattern.
 * Brand colors are hex values matching the CSS custom properties in global.css.
 */

export type GrainGradientShape =
  | 'wave'
  | 'dots'
  | 'truchet'
  | 'corners'
  | 'ripple'
  | 'blob'
  | 'sphere';

export interface GrainGradientConfig {
  colors: string[];
  colorBack: string;
  softness: number;
  intensity: number;
  noise: number;
  shape: GrainGradientShape;
  speed: number;
}

export const PYRE_HEX = {
  black: '#23221c',
  creme: '#f5f1e9',
  red: '#d15232',
  blue: '#274868',
  gold: '#dbb155',
  mutedGold: '#cda56a',
  sage: '#839770',
  sky: '#3991b7',
} as const;

export const heroGrainGradient: GrainGradientConfig = {
  colors: [PYRE_HEX.red, PYRE_HEX.blue, PYRE_HEX.gold, PYRE_HEX.sky],
  colorBack: PYRE_HEX.black,
  softness: 0.6,
  intensity: 0.4,
  noise: 0.35,
  shape: 'wave',
  speed: 0.4,
};

export const footerGrainGradient: GrainGradientConfig = {
  colors: [PYRE_HEX.red, PYRE_HEX.blue, PYRE_HEX.gold, PYRE_HEX.sky],
  colorBack: PYRE_HEX.black,
  softness: 0.6,
  intensity: 0.4,
  noise: 0.35,
  shape: 'wave',
  speed: 0.5,
};
