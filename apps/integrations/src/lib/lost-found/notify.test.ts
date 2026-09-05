import { describe, expect, it } from 'vitest';
import type { LostFoundItemRow } from '@/lib/db';
import { itemLabelFor } from './notify';
import { categoryLabel } from './types';

function item(fields: Partial<LostFoundItemRow>): LostFoundItemRow {
  return { title: 'Black water bottle', category: 'bottle', ...fields } as LostFoundItemRow;
}

describe('itemLabelFor', () => {
  it('adds the category as a noun when the title lacks one', () => {
    expect(itemLabelFor(item({ title: 'Grey', category: 'clothing' }))).toBe(
      `Grey (${categoryLabel('clothing')})`
    );
  });

  it("doesn't repeat a category the title already says", () => {
    expect(itemLabelFor(item({ title: 'Black water bottle', category: 'bottle' }))).toBe(
      'Black water bottle'
    );
  });

  // A category listed in LOST_FOUND_CATEGORIES but missing from
  // CATEGORY_OPTIONS used to hand undefined to toLowerCase() here, killing a
  // whole session blast partway through.
  it('survives a category with no label', () => {
    expect(itemLabelFor(item({ title: 'Grey hoodie', category: 'unlisted' }))).toBe(
      'Grey hoodie (unlisted)'
    );
  });

  it('falls back to the category when there is no title', () => {
    expect(itemLabelFor(item({ title: '   ', category: 'towel' }))).toBe(categoryLabel('towel'));
  });

  it('still says something when neither is usable', () => {
    expect(itemLabelFor(item({ title: '', category: '' }))).toBe('item');
  });
});
