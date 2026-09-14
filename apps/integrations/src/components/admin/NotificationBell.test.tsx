// Static-markup render of the header bell: the badge shows the unread
// count only when there is one, and the button says so for screen readers.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotificationBell } from './NotificationBell';

describe('NotificationBell', () => {
  it('draws no badge when nothing is unread', () => {
    const html = renderToStaticMarkup(<NotificationBell initialCount={0} />);
    expect(html).not.toContain('data-testid="unread-badge"');
    expect(html).toContain('aria-label="Notifications"');
  });

  it('shows the count and names it in the label', () => {
    const html = renderToStaticMarkup(<NotificationBell initialCount={3} />);
    expect(html).toContain('data-testid="unread-badge"');
    expect(html).toContain('>3<');
    expect(html).toContain('aria-label="Notifications, 3 unread"');
  });

  it('caps a runaway count', () => {
    expect(renderToStaticMarkup(<NotificationBell initialCount={250} />)).toContain('99+');
  });
});
