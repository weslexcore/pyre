// The Check Ins view — which sessions' guests the page shows — kept in
// localStorage so a reload opens where it was left. A day or range that has
// wholly passed is dropped: a desk refreshed the next morning should open on
// the floor, not on yesterday.

import { easternDate } from '@pyre/schedule-core';
import {
  DEFAULT_FLOOR_VIEW,
  type FloorView,
  floorViewFields,
  parseFloorView,
} from '@/lib/guests/floor-timing';

const VIEW_KEY = 'pyre-floor-view';

/** The saved view, or the floor when none is saved, it is malformed, or it has passed. */
export function readFloorViewPref(nowMs = Date.now()): FloorView {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    return viewFromPref(raw, nowMs);
  } catch {
    return DEFAULT_FLOOR_VIEW;
  }
}

/** readFloorViewPref's judgement on a parsed value, for tests. */
export function viewFromPref(raw: unknown, nowMs: number): FloorView {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_FLOOR_VIEW;
  const parsed = parseFloorView(raw as Record<string, unknown>);
  if (!parsed.ok) return DEFAULT_FLOOR_VIEW;
  const view = parsed.value;
  if (view.kind === 'day' && view.date < easternDate(new Date(nowMs))) return DEFAULT_FLOOR_VIEW;
  if (view.kind === 'custom' && Date.parse(view.to) < nowMs) return DEFAULT_FLOOR_VIEW;
  return view;
}

export function writeFloorViewPref(view: FloorView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(floorViewFields(view)));
  } catch {
    // Private mode etc. — the view still holds for the session.
  }
}
