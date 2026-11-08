import type { GiftCardData } from '../../templates/gift-card/types.ts';

/**
 * One entry per gift card to print. Replace these placeholders with the real codes before
 * exporting; a code only works once it exists as a gift card in Momence.
 */
export const cards: GiftCardData[] = [
  { code: 'PYRE-7K2M-Q9', value: 50 },
  { code: 'PYRE-3XD8-LA', value: 100, to: 'Sam', from: 'Alex' },
  { code: 'PYRE-H4PT-2N', value: '4 credits', expires: 'use by 12/31/2027' },
];
