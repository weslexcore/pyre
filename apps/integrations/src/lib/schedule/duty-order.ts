// Dragging duties on /admin/schedule/duties: the live arrangement while a
// duty is held, as a flat list in display order. Each phase's section shows
// that phase's duties in list order, so where a duty sits relative to other
// phases' duties doesn't matter — only its phase and its order within it.
//
// Pure, so the drag handlers just call it on every hover and the page sends
// the result on drop (the phase change first, then the whole order).

import type { DutyPhaseKey } from '@pyre/schedule-core';

export interface DutyOrderItem {
  key: string;
  phase: DutyPhaseKey;
}

export type DutyDropTarget = { kind: 'duty'; key: string } | { kind: 'phase'; phase: DutyPhaseKey };

/**
 * `active` moved onto `target`: onto a duty, it takes that duty's place (and
 * phase); onto a section, it goes last in that phase. Returns `items` itself
 * when nothing moves, so a hover that changes nothing doesn't re-render.
 */
export function moveDuty(
  items: readonly DutyOrderItem[],
  active: string,
  target: DutyDropTarget
): readonly DutyOrderItem[] {
  const from = items.findIndex((d) => d.key === active);
  if (from < 0) return items;
  const moving = items[from];

  if (target.kind === 'duty') {
    if (target.key === active) return items;
    const to = items.findIndex((d) => d.key === target.key);
    if (to < 0) return items;
    const next = [...items];
    next.splice(from, 1);
    next.splice(to, 0, { ...moving, phase: items[to].phase });
    return next;
  }

  const lastInPhase = items.reduce((at, d, i) => (d.phase === target.phase ? i : at), -1);
  if (moving.phase === target.phase && lastInPhase === from) return items;
  const next = items.filter((d) => d.key !== active);
  next.push({ ...moving, phase: target.phase });
  return next;
}
