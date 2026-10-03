// The checks that hold an item edit back from autosaving until it's fixed.
import { describe, expect, it } from 'vitest';
import { type ItemForm, itemProblems } from './InventorySetup';

const form = (overrides: Partial<ItemForm> = {}): ItemForm => ({
  name: 'Hand towels',
  variant: '',
  variants: '',
  categoryId: '',
  unitId: '00000000-0000-4000-8000-000000000001',
  lotSize: '1',
  lotUnitId: '',
  reorderLevel: '10',
  reorderTarget: '36',
  countEveryDays: '',
  unitCost: '2.50',
  vendor: '',
  vendorUrl: '',
  notes: '',
  ...overrides,
});

describe('itemProblems', () => {
  it('passes a complete item', () => {
    expect(itemProblems(form(), false)).toEqual({});
  });

  it('needs a name, or a variant label on a variant', () => {
    expect(itemProblems(form({ name: '  ' }), false)).toHaveProperty('name');
    expect(itemProblems(form({ name: '' }), true)).toHaveProperty('variant');
    expect(itemProblems(form({ name: '', variant: 'M' }), true)).toEqual({});
  });

  it('needs a unit and a lot size above 0', () => {
    expect(itemProblems(form({ unitId: '' }), false)).toHaveProperty('unitId');
    expect(itemProblems(form({ lotSize: '0' }), false)).toHaveProperty('lotSize');
    expect(itemProblems(form({ lotSize: '' }), false)).toHaveProperty('lotSize');
  });

  it('holds back a fill-to level below the re-order level', () => {
    expect(itemProblems(form({ reorderTarget: '5' }), false)).toHaveProperty('reorderTarget');
    expect(itemProblems(form({ reorderTarget: '' }), false)).toEqual({});
    expect(itemProblems(form({ reorderLevel: '', reorderTarget: '5' }), false)).toEqual({});
  });

  it('wants a re-order link to be a web address', () => {
    expect(itemProblems(form({ vendorUrl: 'example.com' }), false)).toHaveProperty('vendorUrl');
    expect(itemProblems(form({ vendorUrl: 'https://example.com' }), false)).toEqual({});
  });
});
