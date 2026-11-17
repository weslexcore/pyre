// Inventory suggestions from one run, gathered for review: the grouping that
// decides what becomes a batch, and the batch itself rendered on the server —
// every row editable in place, ticked, with one Approve for all of them.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SuggestionView } from '@/lib/suggestions/types';
import { groupForReview } from './grouping';
import { InventoryBatch } from './InventoryBatch';

const NOTE = '0b6c1f8e-2f9a-4c1e-9a55-6a1d2b3c4d5e';
const ITEM = '9d1e2f3a-4b5c-4d6e-8f70-112233445566';

function suggestion(overrides: Partial<SuggestionView>): SuggestionView {
  return {
    id: 's-1',
    run_id: 'r-1',
    position: 0,
    kind: 'inventory.count',
    status: 'pending',
    source_type: 'shift_note',
    source_id: NOTE,
    source_hash: 'h',
    payload: {
      itemId: ITEM,
      inStock: 3,
      itemName: 'Trash bags',
      previousInStock: 10,
      reorderAt: 4,
      countedBy: 'maya@pyresauna.com',
      countedAt: '2026-11-05T21:00:00Z',
    },
    edited_payload: null,
    edited_by: null,
    edited_at: null,
    rationale: 'The note says three rolls are left.',
    confidence: 0.9,
    target_type: 'inventory_item',
    target_id: ITEM,
    result_type: null,
    result_id: null,
    applied_payload: null,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    error: null,
    agent_session_id: null,
    created_at: '2026-11-05T21:01:00Z',
    updated_at: '2026-11-05T21:01:00Z',
    sourceChanged: false,
    ...overrides,
  };
}

const create = (overrides: Partial<SuggestionView> = {}) =>
  suggestion({
    id: 's-2',
    position: 1,
    kind: 'inventory.create',
    payload: { name: 'Earplugs', location: 'Front desk', inStock: 40 },
    target_type: null,
    target_id: null,
    rationale: 'The desk keeps earplugs now.',
    ...overrides,
  });

describe('groupForReview', () => {
  it("gathers a run's open inventory suggestions into one batch where the first stands", () => {
    const card = suggestion({ id: 'c', kind: 'board_card.create', payload: {} });
    const entries = groupForReview([card, suggestion({}), create()]);
    expect(entries.map((e) => e.type)).toEqual(['single', 'inventory']);
    const batch = entries[1];
    expect(batch.type === 'inventory' && batch.suggestions.map((s) => s.id)).toEqual([
      's-1',
      's-2',
    ]);
  });

  it('leaves a lone inventory suggestion, decided ones and other runs as cards', () => {
    expect(groupForReview([suggestion({})]).map((e) => e.type)).toEqual(['single']);
    expect(
      groupForReview([suggestion({}), create({ status: 'approved' })]).map((e) => e.type)
    ).toEqual(['single', 'single']);
    expect(groupForReview([suggestion({}), create({ run_id: 'r-2' })]).map((e) => e.type)).toEqual([
      'single',
      'single',
    ]);
  });
});

describe('InventoryBatch', () => {
  const html = renderToStaticMarkup(
    <InventoryBatch
      suggestions={[suggestion({}), create()]}
      names={{ 'maya@pyresauna.com': 'Maya' }}
      onChange={() => {}}
    />
  );

  it('says what the update holds and offers one approval for all of it', () => {
    expect(html).toContain('Inventory update');
    expect(html).toContain('1 count and 1 new item');
    expect(html).toContain('Approve all 2');
  });

  it('draws each row editable: the count on its item, the new item by name', () => {
    expect(html).toContain('Trash bags');
    expect(html).toContain('10 on record');
    expect(html).toContain('value="3"');
    expect(html).toContain('−7');
    expect(html).toContain('value="Earplugs"');
    expect(html).toContain('value="Front desk"');
    expect(html).toContain('value="40"');
    expect(html.match(/type="checkbox"[^>]*checked/g)?.length).toBe(2);
  });

  it("credits the counts to the note's author", () => {
    expect(html).toContain('recorded as Maya&#x27;s');
    expect(html).toContain('New items are added as yours');
  });
});
