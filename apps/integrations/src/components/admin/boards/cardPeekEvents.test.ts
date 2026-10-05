import { describe, expect, it } from 'vitest';
import { cardTargetOf } from './cardPeekEvents';

const origin = 'https://admin.example.com';
const id = '0b5c2c1e-6f1a-4d8e-9a33-2f7d1c9e4b10';

describe('cardTargetOf', () => {
  it('reads the board and card from a card link', () => {
    expect(cardTargetOf(`/admin/boards/goals#card-${id}`, origin)).toEqual({ slug: 'goals', id });
    expect(cardTargetOf(`${origin}/admin/boards/rentals?view=calendar#card-${id}`, origin)).toEqual(
      { slug: 'rentals', id }
    );
  });

  it('leaves every other link alone', () => {
    expect(cardTargetOf('/admin/boards/goals', origin)).toBeNull();
    expect(cardTargetOf('/admin/boards/goals#card-nope', origin)).toBeNull();
    expect(cardTargetOf(`/admin/boards/goals/forms#card-${id}`, origin)).toBeNull();
    expect(cardTargetOf(`/admin/sops#card-${id}`, origin)).toBeNull();
    expect(cardTargetOf(`https://elsewhere.com/admin/boards/goals#card-${id}`, origin)).toBeNull();
  });
});
