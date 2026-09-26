// Static-markup render of inbox rows: unread rows are marked, rows without a
// page to open are plain text, and dismiss only appears when offered.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StaffNotificationRow } from '@/lib/db';
import { NotificationList } from './NotificationList';

function row(overrides: Partial<StaffNotificationRow> & { id: string }): StaffNotificationRow {
  return {
    recipient_email: 'me@pyre.test',
    kind: 'schedule_change',
    title: 'Title',
    body: 'Body',
    href: '/admin/schedule',
    source_type: 'shift',
    source_id: 's1',
    actor_email: null,
    read_at: null,
    dismissed_at: null,
    expires_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('NotificationList', () => {
  it('shows the empty text', () => {
    expect(
      renderToStaticMarkup(<NotificationList notifications={[]} emptyText="Quiet." />)
    ).toContain('Quiet.');
  });

  it('marks unread rows and labels the kind', () => {
    const html = renderToStaticMarkup(
      <NotificationList
        notifications={[
          row({ id: 'a' }),
          row({ id: 'b', read_at: '2026-09-14T00:00:00Z', kind: 'sop_updated' }),
        ]}
      />
    );
    expect(html.match(/data-unread="true"/g)?.length).toBe(1);
    expect(html).toContain('Schedule');
    expect(html).toContain('SOP');
  });

  it('links rows with an href and leaves the rest plain', () => {
    const html = renderToStaticMarkup(
      <NotificationList
        notifications={[
          row({ id: 'a', title: 'Linked' }),
          row({ id: 'b', title: 'Plain', href: null }),
        ]}
      />
    );
    expect(html).toContain('href="/admin/schedule"');
    expect(html).toMatch(/<span[^>]*>Plain<\/span>/);
  });

  it('offers dismiss only when a handler is given', () => {
    const rows = [row({ id: 'a', title: 'T' })];
    expect(renderToStaticMarkup(<NotificationList notifications={rows} />)).not.toContain(
      'Dismiss'
    );
    expect(
      renderToStaticMarkup(<NotificationList notifications={rows} onDismiss={() => undefined} />)
    ).toContain('aria-label="Dismiss: T"');
  });

  it('lets rows take a vertical scroll so the swipe never steals it', () => {
    const html = renderToStaticMarkup(
      <NotificationList notifications={[row({ id: 'a' })]} compact onDismiss={() => undefined} />
    );
    expect(html).toContain('touch-pan-y');
    expect(html).toContain('aria-label="Dismiss: Title"');
  });
});
