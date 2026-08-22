// Freshness line copy for /admin/business — the one part of the dashboard a
// reader is meant to trust without checking anything else, so its wording is
// pinned rather than left to drift.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '@/pages/api/admin/business-overview';
import { SyncLine } from './BusinessOverview';

const NOW = new Date('2026-08-22T13:00:00.000Z');

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  reportsSyncedAt: '2026-08-22T10:04:00.000Z',
  activitySyncedAt: '2026-08-22T10:31:00.000Z',
  lastSyncedAt: '2026-08-22T10:04:00.000Z',
  nextSyncAt: '2026-08-23T10:00:00.000Z',
  stale: false,
  missingReportTypes: [],
  ...over,
});

/** Strip tags so assertions read against the sentence a person actually sees. */
const text = (node: React.ReactElement): string =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('SyncLine', () => {
  it('states how old the data is and when it refreshes', () => {
    vi.setSystemTime(NOW);
    const out = text(<SyncLine sync={status()} />);
    expect(out).toContain('Momence data synced 3h ago');
    expect(out).toContain('next sync in 21h');
    // Labor is computed per-request, so it is never as old as the sync.
    expect(out).toContain('labor cost is live from the schedule');
    vi.useRealTimers();
  });

  it('says so plainly when nothing has ever synced', () => {
    vi.setSystemTime(NOW);
    const out = text(<SyncLine sync={status({ lastSyncedAt: null, stale: true })} />);
    expect(out).toContain('Momence data synced never');
    vi.useRealTimers();
  });

  it('carries machine-readable timestamps and a per-feed breakdown', () => {
    vi.setSystemTime(NOW);
    // React 19 emits the prop name verbatim; HTML parses attribute names
    // case-insensitively, so lowercase before asserting on the attribute.
    const html = renderToStaticMarkup(<SyncLine sync={status()} />);
    expect(html.replace(/dateTime=/g, 'datetime=')).toContain(
      'datetime="2026-08-22T10:04:00.000Z"'
    );
    expect(html.replace(/dateTime=/g, 'datetime=')).toContain(
      'datetime="2026-08-23T10:00:00.000Z"'
    );
    // Both feeds are named in the tooltip even though only the stalest shows.
    expect(html).toContain('Revenue:');
    expect(html).toContain('Attendance &amp; members:');
    vi.useRealTimers();
  });

  it('marks a stale timestamp in gold', () => {
    vi.setSystemTime(NOW);
    const fresh = renderToStaticMarkup(<SyncLine sync={status()} />);
    const stale = renderToStaticMarkup(<SyncLine sync={status({ stale: true })} />);
    expect(fresh).not.toContain('--pyre-gold');
    expect(stale).toContain('--pyre-gold');
    vi.useRealTimers();
  });
});
