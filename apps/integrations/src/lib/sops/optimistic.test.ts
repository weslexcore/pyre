import { describe, expect, it } from 'vitest';
import type { SopRunCheckRow } from '@/lib/db';
import {
  applyCheck,
  applyUncheck,
  isPersisted,
  LOCAL_ID_PREFIX,
  pendingRun,
  type RunState,
  reconcileRun,
  revertCheck,
  revertUncheck,
} from './optimistic';

const NOW = '2026-09-02T15:00:00.000Z';
const SOP = { id: 'sop-1', current_version: 3 };

function check(index: number, by = 'lead@pyresauna.com'): SopRunCheckRow {
  return {
    id: `row-${index}`,
    run_id: 'run-1',
    item_index: index,
    item_text: `Item ${index}`,
    checked_by: by,
    checked_at: NOW,
  };
}

function state(checks: SopRunCheckRow[]): RunState {
  return {
    run: { ...pendingRun(SOP, 5, 'lead@pyresauna.com', NOW), id: 'run-1' },
    checks,
    content: '- [ ] a',
  };
}

describe('pendingRun', () => {
  it('is an unpersisted in-progress run pinned to the current version', () => {
    const run = pendingRun(SOP, 7, 'me@pyresauna.com', NOW);
    expect(isPersisted(run)).toBe(false);
    expect(run.status).toBe('in_progress');
    expect(run.sop_version).toBe(3);
    expect(run.task_count).toBe(7);
    expect(run.started_by).toBe('me@pyresauna.com');
  });
});

describe('applyCheck', () => {
  it('adds only the indexes not already checked, in index order', () => {
    const { next, added } = applyCheck(
      state([check(2)]),
      [
        { itemIndex: 4, itemText: 'four' },
        { itemIndex: 2, itemText: 'two' },
        { itemIndex: 1, itemText: 'one' },
      ],
      'me@pyresauna.com',
      NOW
    );
    expect(added).toEqual([4, 1]);
    expect(next.checks.map((c) => c.item_index)).toEqual([1, 2, 4]);
    expect(next.checks[0].id).toBe(`${LOCAL_ID_PREFIX}1`);
    expect(next.checks[0].checked_by).toBe('me@pyresauna.com');
    // The teammate's row is untouched.
    expect(next.checks[1]).toBe(next.checks.find((c) => c.item_index === 2));
  });

  it('returns the same state when nothing is new', () => {
    const before = state([check(2)]);
    const { next, added } = applyCheck(before, [{ itemIndex: 2, itemText: 'two' }], 'x', NOW);
    expect(added).toEqual([]);
    expect(next).toBe(before);
  });
});

describe('applyUncheck / revertUncheck', () => {
  it('removes the row and hands it back for revert', () => {
    const before = state([check(1), check(2)]);
    const { next, removed } = applyUncheck(before, 1);
    expect(removed?.item_index).toBe(1);
    expect(next.checks.map((c) => c.item_index)).toEqual([2]);
    expect(revertUncheck(next, removed as SopRunCheckRow)).toEqual(before);
  });

  it('is a no-op for an unchecked item', () => {
    const before = state([check(2)]);
    const { next, removed } = applyUncheck(before, 9);
    expect(removed).toBeNull();
    expect(next).toBe(before);
  });
});

describe('revertCheck', () => {
  it('drops exactly the indexes the tap added', () => {
    const before = state([check(2)]);
    const { next, added } = applyCheck(
      before,
      [
        { itemIndex: 3, itemText: 'three' },
        { itemIndex: 2, itemText: 'two' },
      ],
      'x',
      NOW
    );
    expect(revertCheck(next, added)).toEqual(before);
  });
});

describe('reconcileRun', () => {
  const persisted = state([check(1)]);
  const serverRun = { ...persisted.run, id: 'run-1' };

  it('clears everything when the server has no run and nothing is checked locally', () => {
    expect(reconcileRun({ run: null, last: persisted }, { run: null }, true, 'x')).toEqual({
      run: null,
      last: null,
    });
    const empty = { ...persisted, checks: [] };
    expect(reconcileRun({ run: empty, last: empty }, { run: null }, true, 'x')).toEqual({
      run: null,
      last: null,
    });
  });

  it('forgets the id of a vanished run when local taps re-checked items', () => {
    const out = reconcileRun({ run: persisted, last: persisted }, { run: null }, false, 'x');
    expect(out.run?.run.id).toBe('');
    expect(out.run?.checks).toEqual(persisted.checks);
    expect(out.last).toBe(out.run);
  });

  it('leaves an unpersisted local run alone when the server has none', () => {
    const local = { ...persisted, run: { ...persisted.run, id: '' } };
    const refs = { run: local, last: local };
    expect(reconcileRun(refs, { run: null }, true, 'x')).toBe(refs);
  });

  it('adopts a teammate-held run on screen only as the last queued op', () => {
    const body = { run: serverRun, checks: [check(3, 'mate@pyresauna.com')], content: 'srv' };
    const shown = reconcileRun({ run: null, last: null }, body, true, 'x');
    expect(shown.run?.checks.map((c) => c.item_index)).toEqual([3]);
    expect(shown.run?.content).toBe('srv');
    expect(shown.last).toBe(shown.run);

    const remembered = reconcileRun({ run: null, last: null }, body, false, 'x');
    expect(remembered.run).toBeNull();
    expect(remembered.last?.run.id).toBe('run-1');
    expect(remembered.last?.checks).toEqual([]);
  });

  it('falls back to the remembered content, then the document, for a bare run', () => {
    const viaLast = reconcileRun(
      { run: null, last: { ...persisted, content: 'pinned' } },
      { run: serverRun },
      true,
      'doc'
    );
    expect(viaLast.last?.content).toBe('pinned');
    const viaDoc = reconcileRun({ run: null, last: null }, { run: serverRun }, true, 'doc');
    expect(viaDoc.last?.content).toBe('doc');
  });

  it('takes the run row always and the checks only when last in the queue', () => {
    const local = { ...persisted, run: { ...persisted.run, id: '' } };
    const body = { run: serverRun, checks: [check(1), check(2)] };
    const last = reconcileRun({ run: local, last: local }, body, true, 'x');
    expect(last.run?.run.id).toBe('run-1');
    expect(last.run?.checks.map((c) => c.item_index)).toEqual([1, 2]);
    expect(last.last).toBe(last.run);

    const midQueue = reconcileRun({ run: local, last: local }, body, false, 'x');
    expect(midQueue.run?.run.id).toBe('run-1');
    expect(midQueue.run?.checks).toBe(local.checks);
  });
});
