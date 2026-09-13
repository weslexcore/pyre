// Static-markup render of the run log: skipped items read as skipped (by
// whom, when) rather than as blanks, and a finished run from before skipping
// existed that ended short lists the items nobody checked, by name, so the
// log shows what was left undone rather than only how many items were.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { progressLabel, type RunEntry, RunRecord, RunsList } from './SopRunsList';

const RUN: RunEntry = {
  id: 'run-1',
  sop_id: 'sop-1',
  sop_version: 2,
  task_count: 3,
  status: 'completed',
  started_by: 'marina@pyresauna.com',
  started_at: '2026-09-01T14:00:00Z',
  ended_by: 'marina@pyresauna.com',
  ended_at: '2026-09-01T14:20:00Z',
  created_at: '2026-09-01T14:00:00Z',
  updated_at: '2026-09-01T14:20:00Z',
  sops: { title: 'Closing', slug: 'closing', category: 'Ops' },
  sop_run_checks: [
    {
      item_index: 1,
      item_text: 'Lock the gate',
      checked_by: 'marina@pyresauna.com',
      checked_at: '2026-09-01T14:10:00Z',
      skipped: false,
    },
  ],
  unchecked: [
    { item_index: 0, item_text: 'Rake coals' },
    { item_index: 2, item_text: 'Lights off' },
  ],
};

// The same closing, run today: every item resolved, one of them by skipping.
const RESOLVED: RunEntry = {
  ...RUN,
  id: 'run-2',
  sop_run_checks: [
    {
      item_index: 0,
      item_text: 'Rake coals',
      checked_by: 'marina@pyresauna.com',
      checked_at: '2026-09-01T14:05:00Z',
      skipped: false,
    },
    {
      item_index: 1,
      item_text: 'Lock the gate',
      checked_by: 'bob@pyresauna.com',
      checked_at: '2026-09-01T14:10:00Z',
      skipped: true,
    },
    {
      item_index: 2,
      item_text: 'Lights off',
      checked_by: 'marina@pyresauna.com',
      checked_at: '2026-09-01T14:20:00Z',
      skipped: false,
    },
  ],
  unchecked: undefined,
};

describe('progressLabel', () => {
  it('counts completed items over the total and calls out the skips', () => {
    expect(progressLabel(RUN.sop_run_checks, 3)).toBe('1/3');
    expect(progressLabel(RESOLVED.sop_run_checks, 3)).toBe('2/3 · 1 skipped');
  });
});

describe('RunsList', () => {
  it('summarizes a short-ended run by count while collapsed', () => {
    const html = renderToStaticMarkup(<RunsList runs={[RUN]} />);
    expect(html).toContain('1/3');
    expect(html).toContain('items never checked');
    expect(html).not.toContain('Rake coals');
  });

  it('shows a fully resolved run with a skip as complete, skip counted', () => {
    const html = renderToStaticMarkup(<RunsList runs={[RESOLVED]} />);
    expect(html).toContain('2/3 · 1 skipped');
    expect(html).not.toContain('never checked');
    // The whole-list colour says every item was accounted for.
    expect(html).toContain('text-[var(--pyre-sage)]">2/3');
  });

  it('says who skipped an item, and when, in the expanded record', () => {
    const html = renderToStaticMarkup(
      <RunRecord
        run={RESOLVED}
        checks={RESOLVED.sop_run_checks}
        people={{ 'bob@pyresauna.com': 'Bob' }}
      />
    );
    expect(html).toContain('skipped by Bob');
    expect(html).toContain('Lock the gate');
    expect(html.match(/✓/g)?.length).toBe(2);
    expect(html).not.toContain('never checked');
  });

  it('lists the skipped items by name in the expanded record', () => {
    const html = renderToStaticMarkup(<RunRecord run={RUN} checks={RUN.sop_run_checks} />);
    expect(html).toContain('Lock the gate');
    expect(html).toContain('2 items never checked:');
    expect(html).toContain('Rake coals');
    expect(html).toContain('Lights off');
    expect(html).toContain('not checked');
  });

  it('falls back to the count when the pinned snapshot could not be resolved', () => {
    const entry = { ...RUN, unchecked: undefined };
    const html = renderToStaticMarkup(<RunRecord run={entry} checks={entry.sop_run_checks} />);
    expect(html).toContain('2 items never checked.');
    expect(html).not.toContain('not checked<');
  });

  it('never reports skipped items on a run still in progress', () => {
    const entry: RunEntry = { ...RUN, status: 'in_progress', ended_by: null, ended_at: null };
    const html = renderToStaticMarkup(<RunRecord run={entry} checks={entry.sop_run_checks} />);
    expect(html).not.toContain('never checked');
  });
});
