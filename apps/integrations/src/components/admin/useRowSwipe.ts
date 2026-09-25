// Swipe a row to act on it: the pointer half of the gesture, with the
// arithmetic in lib/sops/swipe. A row tracks the finger horizontally, shows
// what a release would do, and commits on lift. Which action a direction
// means is the caller's (actionAt) — a checklist row completes or skips, an
// inbox row dismisses or flips read.
//
// Two things this has to get right on a phone. It must not steal vertical
// scrolling: the gesture stays unclaimed until the finger has moved further
// across than down, and the row carries touch-action: pan-y so the browser
// keeps the other axis (a scroll that starts on a row arrives here as a
// pointercancel, which resets without firing). And it must not double-fire:
// the row's tap target is a <label> around a visually hidden checkbox, so the
// click synthesized after a drag would toggle the box on top of whatever the
// swipe just did — onClickCapture swallows exactly that one click.
//
// State lives per row, so a drag re-renders the row under the finger and
// nothing else.
import { type MouseEvent, type PointerEvent, useCallback, useRef, useState } from 'react';
import { SWIPE_SLOP, swipeArmed, swipeOffset } from '@/lib/sops/swipe';

export interface RowSwipe<A extends string> {
  /** Spread onto the row element that hosts the gesture. */
  handlers: {
    onPointerDown: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerUp: (e: PointerEvent) => void;
    onPointerCancel: (e: PointerEvent) => void;
    onClickCapture: (e: MouseEvent) => void;
  };
  /** How far the row content should be translated, in px (0 at rest). */
  dx: number;
  /** A claimed gesture is in progress: no transition, and the row is opaque. */
  dragging: boolean;
  /** What a release right now would do, or null in a direction that does nothing. */
  action: A | null;
  /** The drag has passed the commit point. */
  armed: boolean;
}

export function useRowSwipe<A extends string>({
  enabled,
  actionAt,
  onAction,
}: {
  /** False where the row takes no input at all (a finished run). */
  enabled: boolean;
  /** The action a release at this delta would commit; null in a dead direction. */
  actionAt: (dx: number) => A | null;
  onAction: (action: A) => void;
}): RowSwipe<A> {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  // The gesture reads the latest row state and callback at pointer time, not
  // the render the handler was created in.
  const latest = useRef({ enabled, actionAt, onAction });
  latest.current = { enabled, actionAt, onAction };

  // Live gesture bookkeeping: nothing here should re-render on its own.
  const gesture = useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    claimed: false,
    raw: 0,
  });
  const suppressClick = useRef(false);

  const reset = useCallback(() => {
    gesture.current.pointerId = null;
    gesture.current.claimed = false;
    gesture.current.raw = 0;
    setDragging(false);
    setDx(0);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent) => {
    // A drag does not always leave a click behind for onClickCapture to eat
    // (a touch drag usually leaves none at all), so the guard is cleared at
    // the start of the next gesture rather than waiting for a click that may
    // never come — otherwise it would swallow the next real tap. Any click
    // owed to the previous gesture has already fired by now.
    suppressClick.current = false;
    // Mouse stays out of it: selecting text and the drag-to-reorder lists
    // elsewhere in admin should behave exactly as they always have.
    if (!latest.current.enabled || e.pointerType === 'mouse' || !e.isPrimary) return;
    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      claimed: false,
      raw: 0,
    };
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    if (g.pointerId !== e.pointerId) return;
    const acrossRaw = e.clientX - g.startX;
    const downRaw = e.clientY - g.startY;
    if (!g.claimed) {
      // Down beats across: leave the gesture to the scroller and stay out of
      // the way for the rest of this pointer.
      if (Math.abs(downRaw) > Math.abs(acrossRaw)) {
        g.pointerId = null;
        return;
      }
      if (Math.abs(acrossRaw) <= SWIPE_SLOP) return;
      g.claimed = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    // Claiming the gesture consumes the slop, so the row starts moving from
    // where the finger already is rather than jumping to meet it.
    g.raw = acrossRaw - Math.sign(acrossRaw) * SWIPE_SLOP;
    setDx(swipeOffset(g.raw, latest.current.actionAt(g.raw) !== null));
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (g.pointerId !== e.pointerId) return;
      if (g.claimed) {
        // Whatever happens next, the click that follows a drag is not a tap.
        suppressClick.current = true;
        const action = latest.current.actionAt(g.raw);
        if (action && swipeArmed(g.raw)) latest.current.onAction(action);
      }
      reset();
    },
    [reset]
  );

  const onPointerCancel = useCallback(
    (e: PointerEvent) => {
      if (gesture.current.pointerId !== e.pointerId) return;
      // The browser took the gesture (usually to scroll): nothing fires, and
      // there is no click to swallow — the row just goes home.
      reset();
    },
    [reset]
  );

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    dx,
    dragging,
    action: dragging ? actionAt(dx) : null,
    armed: dragging && swipeArmed(dx),
  };
}
