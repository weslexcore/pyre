export const DIVIDER_VARIANTS = ['wave', 'squiggle', 'zigzag', 'blob', 'scallop', 'torn'] as const;
export type DividerVariant = (typeof DIVIDER_VARIANTS)[number];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function getDividerVariant(seed: string): DividerVariant {
  const hash = hashString(seed);
  return DIVIDER_VARIANTS[hash % DIVIDER_VARIANTS.length];
}
