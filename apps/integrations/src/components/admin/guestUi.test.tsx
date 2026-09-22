import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FieldRow } from './guestUi';

describe('board date and time controls', () => {
  it.each([
    ['date', '2026-10-03'],
    ['time', '18:30'],
  ] as const)('renders a labeled native %s picker with its saved value', (kind, value) => {
    const html = renderToStaticMarkup(
      <FieldRow
        idPrefix="lead"
        field={{ key: `requested_${kind}`, label: `Requested ${kind}`, kind, options: [] }}
        value={value}
        onChange={() => {}}
      />
    );
    expect(html).toContain(`type="${kind}"`);
    expect(html).toContain(`value="${value}"`);
    expect(html).toContain(`for="lead-requested_${kind}"`);
  });

  it('leaves an unknown time blank and shows the venue timezone hint', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        field={{
          key: 'requested_time',
          label: 'Requested time',
          kind: 'time',
          options: [],
          hint: 'Eastern Time (America/New_York).',
        }}
        value={undefined}
        onChange={() => {}}
      />
    );
    expect(html).toContain('value=""');
    expect(html).toContain('Eastern Time (America/New_York).');
  });
});
