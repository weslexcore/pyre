// Pyre brand palette (hex — email clients don't support oklch / CSS vars).
// Lives in its own module so EmailLayout and EmailFooter can both import it
// without a circular dependency.
export const COLORS = {
  black: '#23221c',
  creme: '#f5f1e9',
  red: '#d15232',
} as const;
