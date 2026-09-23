import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LINK_COUNTS,
  type LinkPerformance,
  linkColor,
} from '@/lib/campaigns/link-performance';
import { LinkBar, LinkBreakdown } from './LinkBreakdown';

const segments = [
  { id: 'a', label: 'Newsletter', value: 3 },
  { id: 'b', label: 'Instagram', value: 1 },
];
describe('colored link bars', () => {
  it('partitions metric totals into labeled, consistently colored links', () => {
    const html = renderToStaticMarkup(
      <LinkBar segments={segments} total={4} label="Memberships" />
    );
    expect(html).toContain('width:75%');
    expect(html).toContain('width:25%');
    expect(html).toContain('Newsletter: 3 (75%)');
    expect(html).toContain('aria-label="Memberships: Newsletter 3, Instagram 1"');
    expect(html).toContain(linkColor('a'));
  });
  it('keeps unfilled goal space and an expected-pace marker', () => {
    const html = renderToStaticMarkup(
      <LinkBar segments={segments} total={4} target={10} pace={5} label="Goal" />
    );
    expect(html).toContain('width:30%');
    expect(html).toContain('width:10%');
    expect(html).toContain('left:50%');
  });
  it('shows proportional contributions when a goal exceeds its target', () => {
    const html = renderToStaticMarkup(
      <LinkBar segments={segments} total={4} target={2} label="Goal" />
    );
    expect(html).toContain('width:75%');
    expect(html).not.toContain('width:150%');
  });
  it('renders empty and unknown states without invalid widths', () => {
    const html = renderToStaticMarkup(<LinkBar segments={[]} total={0} label="Bookings" />);
    expect(html).toContain('No data');
    expect(html).not.toContain('NaN');
    const unknown = renderToStaticMarkup(
      <LinkBar
        segments={[{ id: 'unknown', label: 'Unknown link', value: 1 }]}
        total={1}
        label="Bookings"
      />
    );
    expect(unknown).toContain('#737373');
  });
});
describe('link results table', () => {
  const links: LinkPerformance[] = [
    {
      ...EMPTY_LINK_COUNTS,
      id: 'a',
      label: 'Newsletter',
      url: null,
      tags: null,
      clicks: 12,
      bookings: 3,
      memberships: 2,
    },
  ];
  it('provides numeric results and a legend instead of relying on color alone', () => {
    const html = renderToStaticMarkup(<LinkBreakdown links={links} conversionsAvailable />);
    expect(html).toContain('Link colors');
    expect(html).toContain('scope="row"');
    expect(html).toContain('>3</td>');
    expect(html).toContain('>2</td>');
    expect(html).toContain('Memberships');
  });
  it('does not show unavailable conversion counts as zeros', () => {
    const html = renderToStaticMarkup(<LinkBreakdown links={links} conversionsAvailable={false} />);
    expect(html).toContain('>12</td>');
    expect(html).not.toContain('>3</td>');
    expect(html).toContain('>–</td>');
  });
});
