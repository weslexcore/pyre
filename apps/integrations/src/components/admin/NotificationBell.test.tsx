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

  // The popover is `absolute inset-x-0` on mobile so it spans the header's
  // relative row. A `relative` wrapper here would make the 40px button the
  // containing block instead and squeeze the panel down to the bell's width.
  it('leaves the popover wrapper static below md so the panel spans the header', () => {
    const html = renderToStaticMarkup(<NotificationBell initialCount={1} />);
    const wrapper = /<div class="([^"]*)"><button/.exec(html)?.[1];
    expect(wrapper).toBe('md:relative');
  });
});
