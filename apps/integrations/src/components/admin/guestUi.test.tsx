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

  it('splits a date & time into a date and an optional time, one pair per answer', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        idPrefix="lead"
        field={{ key: 'session', label: 'Session', kind: 'datetime', options: [] }}
        value={['2026-10-03T18:30', '2026-10-04']}
        onChange={() => {}}
      />
    );
    expect(html).toContain('value="2026-10-03"');
    expect(html).toContain('value="18:30"');
    expect(html).toContain('value="2026-10-04"');
    // The second answer has no time, and its clock is left blank.
    expect(html.match(/type="time"/g)).toHaveLength(2);
    expect(html).toContain('value=""');
    expect(html).toContain('Session, time 2 (optional)');
    expect(html).toContain('Add another date');
  });

  it('takes several times on a time field', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        field={{ key: 'arrival', label: 'Arrival', kind: 'time', options: [] }}
        value={['18:00', '20:00']}
        onChange={() => {}}
      />
    );
    expect(html).toContain('value="18:00"');
    expect(html).toContain('value="20:00"');
    expect(html).toContain('Add another time');
  });
});
