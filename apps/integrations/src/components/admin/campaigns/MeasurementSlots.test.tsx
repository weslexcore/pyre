import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MeasurementSlots } from './MeasurementSlots';

const events = {
  items: [
    { id: '1', title: 'Friday sauna', date: '2026-09-25', time: '6:00 PM', durationMinutes: 180 },
    { id: '2', title: 'Friday sauna', time: '7:00 PM', durationMinutes: 60 },
  ],
  loading: false,
  error: null,
  sessionExpired: false,
  load: vi.fn(),
};
describe('measurement picker', () => {
  it('shows saved selections including slots that disappeared from the feed', () => {
    const html = renderToStaticMarkup(
      <MeasurementSlots events={events} value={['1', '99']} onChange={vi.fn()} />
    );
    expect(html).toContain('Friday sauna (2026-09-25 6:00 PM) · 180 min');
    expect(html).toContain('Slot 99 (not currently listed)');
    expect(html).toContain('Remove slot 99');
    expect(html).toContain('Friday sauna (7:00 PM) · 60 min');
    expect(html).toContain('2 of 50');
  });
  it('explains an explicitly cleared selection', () => {
    expect(
      renderToStaticMarkup(<MeasurementSlots events={events} value={[]} onChange={vi.fn()} />)
    ).toContain('No event totals will be shown.');
  });
});
