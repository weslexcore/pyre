// Static-markup render of the run log's expanded record: a finished run that
// ended short lists the items nobody checked, by name, so the log shows what
// was left undone rather than only how many items were.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type RunEntry, RunRecord, RunsList } from './SopRunsList';

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
    },
  ],
  unchecked: [
    { item_index: 0, item_text: 'Rake coals' },
    { item_index: 2, item_text: 'Lights off' },
  ],
};

describe('RunsList', () => {
  it('summarizes a short-ended run by count while collapsed', () => {
    const html = renderToStaticMarkup(<RunsList runs={[RUN]} />);
    expect(html).toContain('1/3');
    expect(html).toContain('items skipped');
    expect(html).not.toContain('Rake coals');
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
