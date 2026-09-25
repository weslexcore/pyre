// The suggestion card, rendered on the server: a pending suggestion opens as
// its kind's editor with Approve and Dismiss, and a decided one folds to a
// line with a link to what it made.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SuggestionView } from '@/lib/suggestions/types';
import { SuggestionCard } from './SuggestionCard';

const NOTE = '0b6c1f8e-2f9a-4c1e-9a55-6a1d2b3c4d5e';
const CARD = '9d1e2f3a-4b5c-4d6e-8f70-112233445566';

function suggestion(overrides: Partial<SuggestionView>): SuggestionView {
  return {
    id: 's-1',
    run_id: 'r-1',
    position: 0,
    kind: 'board_card.create',
    status: 'pending',
    source_type: 'shift_note',
    source_id: NOTE,
    source_hash: 'h',
    payload: {
      board: 'goals',
      columnKey: null,
      title: 'Replace left tub filter',
      notesMd: 'Water is cloudy.',
      dueDate: '2026-09-27',
      properties: {},
    },
    edited_payload: null,
    edited_by: null,
    edited_at: null,
    rationale: 'The note asks for it before Saturday.',
    confidence: 0.9,
    target_type: null,
    target_id: null,
    result_type: null,
    result_id: null,
    applied_payload: null,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    error: null,
    agent_session_id: null,
    created_at: '2026-09-25T12:00:00Z',
    updated_at: '2026-09-25T12:00:00Z',
    sourceChanged: false,
    ...overrides,
  };
}

const noop = () => {};

describe('SuggestionCard', () => {
  it('opens a pending card suggestion as an editor', () => {
    const html = renderToStaticMarkup(
      <SuggestionCard suggestion={suggestion({})} names={{}} onChange={noop} />
    );
    expect(html).toContain('New task');
    expect(html).toContain('value="Replace left tub filter"');
    expect(html).toContain('value="2026-09-27"');
    expect(html).toContain('The note asks for it before Saturday.');
    expect(html).toContain('>Approve<');
    expect(html).toContain('>Dismiss<');
    expect(html).toContain('90% sure');
  });

  it('says when the admin has edited it, and offers the original back', () => {
    const html = renderToStaticMarkup(
      <SuggestionCard
        suggestion={suggestion({
          edited_payload: {
            board: 'goals',
            columnKey: null,
            title: 'Replace the left cold tub filter',
            notesMd: '',
            dueDate: null,
            properties: {},
          },
          edited_by: 'wes@pyresauna.com',
          edited_at: '2026-09-25T12:05:00Z',
        })}
        names={{ 'wes@pyresauna.com': 'Wes' }}
        onChange={noop}
      />
    );
    expect(html).toContain('edited by Wes');
    expect(html).toContain('Approve with edits');
    expect(html).toContain('Reset to the AI’s version');
  });

  it('names the card a comment goes on', () => {
    const html = renderToStaticMarkup(
      <SuggestionCard
        suggestion={suggestion({
          kind: 'board_card.comment',
          payload: { cardId: CARD, note: 'Cut out again tonight.' },
          target_type: 'board_card',
          target_id: CARD,
        })}
        target={{ label: 'Fix sauna heater', href: `/admin/boards/goals#card-${CARD}` }}
        names={{}}
        onChange={noop}
      />
    );
    expect(html).toContain('Comment on task');
    expect(html).toContain(`href="/admin/boards/goals#card-${CARD}"`);
    expect(html).toContain('Cut out again tonight.');
  });

  it('folds a decided suggestion to a line linking what it made', () => {
    const html = renderToStaticMarkup(
      <SuggestionCard
        suggestion={suggestion({
          status: 'approved',
          decided_by: 'wes@pyresauna.com',
          decided_at: '2026-09-25T12:10:00Z',
        })}
        result={{ label: 'Replace left tub filter', href: `/admin/boards/goals#card-${CARD}` }}
        names={{ 'wes@pyresauna.com': 'Wes' }}
        onChange={noop}
      />
    );
    expect(html).toContain('approved by Wes');
    expect(html).toContain(`href="/admin/boards/goals#card-${CARD}"`);
    expect(html).not.toContain('>Approve<');
  });

  it('shows why a dismissed suggestion was turned down', () => {
    const html = renderToStaticMarkup(
      <SuggestionCard
        suggestion={suggestion({
          status: 'dismissed',
          decided_by: 'wes@pyresauna.com',
          decided_at: '2026-09-25T12:10:00Z',
          decision_note: 'We have towels',
        })}
        names={{}}
        onChange={noop}
      />
    );
    expect(html).toContain('dismissed');
    expect(html).toContain('We have towels');
  });
});
