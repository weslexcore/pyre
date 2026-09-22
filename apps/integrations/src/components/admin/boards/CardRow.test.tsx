import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BoardCardRow, BoardFieldRow } from '@/lib/db';
import { CardRow } from './CardRow';

function renderField(
  overrides: Partial<BoardFieldRow> = {},
  value: string | number | boolean = 12
) {
  const field = {
    id: 'field',
    board_id: 'board',
    key: 'party_size',
    label: 'Party size',
    kind: 'number',
    options: [],
    hint: null,
    show_on_card: true,
    show_label_on_card: true,
    show_on_calendar: false,
    calendar_time_key: null,
    sort_order: 10,
    archived: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  } satisfies BoardFieldRow;
  const card = {
    id: 'card',
    title: 'Booking',
    column_id: 'open',
    completed_at: null,
    properties: { party_size: value },
  } as unknown as BoardCardRow;
  return renderToStaticMarkup(
    <CardRow
      card={card}
      columns={[]}
      people={{}}
      today="2026-09-22"
      fields={[field]}
      onOpen={() => {}}
    />
  );
}

describe('card field labels', () => {
  it('shows the label with the value by default', () => {
    expect(renderField()).toContain('Party size: 12');
  });

  it('shows only the value when the field label is disabled', () => {
    const html = renderField({ show_label_on_card: false });
    expect(html).toContain('>12</span>');
    expect(html).not.toContain('Party size');
  });

  it('keeps zero and false values visible without a label', () => {
    expect(renderField({ show_label_on_card: false }, 0)).toContain('>0</span>');
    expect(renderField({ kind: 'yes_no', show_label_on_card: false }, false)).toContain(
      '>No</span>'
    );
  });

  it('hides both label and value when the field is not shown on cards or has no value', () => {
    for (const html of [renderField({ show_on_card: false }), renderField({ kind: 'text' }, '')]) {
      expect(html).not.toContain('Party size');
      expect(html).not.toContain('>12</span>');
    }
  });
});
