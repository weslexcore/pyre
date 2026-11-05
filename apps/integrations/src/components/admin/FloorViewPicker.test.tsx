// Static-markup render of the view picker: the chosen view is the pressed
// pill, a day shows its date controls, a range its two times on the studio
// clock.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultRange, FloorViewPicker } from './FloorViewPicker';

const render = (view: Parameters<typeof FloorViewPicker>[0]['view']) =>
  renderToStaticMarkup(<FloorViewPicker view={view} today="2026-11-05" onChange={() => {}} />);

describe('FloorViewPicker', () => {
  it('presses the chosen pill and shows nothing else for the floor', () => {
    const html = render({ kind: 'floor' });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Now</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Next session</);
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('type="datetime-local"');
  });

  it('shows the date controls for a day, with Today disabled on today', () => {
    const html = render({ kind: 'day', date: '2026-11-05' });
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-11-05"');
    expect(html).toMatch(/disabled=""[^>]*>Today</);
    expect(html).toContain('Thu, Nov 5');
  });

  it('shows a range as two studio-clock times', () => {
    const html = render({
      kind: 'custom',
      from: '2026-11-05T15:00:00.000Z',
      to: '2026-11-05T21:30:00.000Z',
    });
    expect(html).toContain('value="2026-11-05T10:00"');
    expect(html).toContain('value="2026-11-05T16:30"');
  });

  it('offers four hours from the top of the hour as the first range', () => {
    expect(defaultRange(Date.parse('2026-11-05T19:17:00Z'))).toEqual({
      from: '2026-11-05T19:00:00.000Z',
      to: '2026-11-05T23:00:00.000Z',
    });
  });
});
