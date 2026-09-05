import { describe, expect, it } from 'vitest';
import type { LostFoundItemRow } from '@/lib/db';
import { itemLabelFor } from './notify';

function item(fields: Partial<LostFoundItemRow>): LostFoundItemRow {
  return { title: 'Black water bottle', ...fields } as LostFoundItemRow;
}

describe('itemLabelFor', () => {
  it('is the title staff typed, which is written to be recognised', () => {
    expect(itemLabelFor(item({ title: '  Black water bottle  ' }))).toBe('Black water bottle');
  });

  // This is the subject line of an email to a guest, composed after the item
  // row is already saved. A blank title used to reach toLowerCase() through a
  // missing category label and take a whole session blast down with it.
  it('still says something when the title is blank', () => {
    expect(itemLabelFor(item({ title: '   ' }))).toBe('item');
    expect(itemLabelFor({} as LostFoundItemRow)).toBe('item');
  });
});
