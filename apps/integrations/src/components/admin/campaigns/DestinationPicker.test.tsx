// Editing a campaign whose event the feed no longer carries. The pick has to
// survive: the admin should not have to find the event again, and cannot when
// it has already happened and dropped off the upcoming list.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EventOption } from '@/lib/campaigns/types';
import { DestinationPicker, type EventsState } from './DestinationPicker';

const ORIGIN = 'https://www.pyresauna.com';

function eventsState(items: EventOption[] | null, extra: Partial<EventsState> = {}): EventsState {
  return {
    items,
    loading: false,
    error: null,
    sessionExpired: false,
    load: () => {},
    ...extra,
  };
}

function render(events: EventsState, value: string) {
  return renderToStaticMarkup(
    <DestinationPicker
      origin={ORIGIN}
      blogPosts={[]}
      events={events}
      value={{ kind: 'event', value }}
      onChange={() => {}}
    />
  );
}

const UPCOMING: EventOption = { id: '222', title: 'Rest Fest', date: 'Sat, July 4, 2026' };

describe('DestinationPicker, on an event campaign', () => {
  it('shows the event as picked when it is still in the list', () => {
    const html = render(eventsState([UPCOMING]), '222');
    expect(html).toContain('Rest Fest');
  });

  it('keeps the event picked when the list no longer carries it', () => {
    const html = render(eventsState([UPCOMING]), '111');
    // Named by id rather than left blank, so it reads as a pick that stands.
    expect(html).toContain('Event 111');
    expect(html).not.toContain('value=""');
  });

  it('keeps the event picked when the list fails to load', () => {
    const html = render(eventsState(null, { error: 'Failed to load' }), '111');
    expect(html).toContain('Event 111');
  });

  it('still links to the event page, whatever the list knows', () => {
    expect(render(eventsState([UPCOMING]), '111')).toContain(`${ORIGIN}/events/111`);
  });

  it('says so when there is no event picked and none to pick', () => {
    const html = render(eventsState([]), '');
    expect(html).toContain('No upcoming events on the site right now.');
  });
});
