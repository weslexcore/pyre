// Swipe-to-close for a bottom sheet: the touch half of the gesture, with the
// arithmetic in lib/boards/sheet. On a phone the card drawer is a sheet
// pulled up from the bottom edge, so a pull back down — from anywhere on it,
// once it is scrolled to its top — takes it away again, and a pull that
// stops short lets it settle back.
//
// This one runs on touch events rather than the pointer events the row
// swipe uses. The sheet is a scroller, and a pointer gesture on a scroller
// is the browser's the moment it moves vertically (touch-action decides that
// at the start of the touch, before we know the scroll position), so the
// only way to keep a downward pull on a sheet already at its top is to
// listen to the touch itself and preventDefault the moves we claim. Nothing
// is claimed until the finger has moved down past the slop with the sheet
// at its top; sideways or upward movement, or a sheet scrolled anywhere
// else, is left to the scroller for the rest of that touch.
//
// The sheet is moved with the Web Animations API instead of an inline
// transform: the drawer's entry is a CSS animation whose fill holds the
// resting transform, and an animation created later wins over it, then
// falls away again once cancelled, leaving the entry animation intact for
// the Close button to reverse. Nothing here re-renders the drawer: the
// forms inside it are heavy, and the finger moves sixty times a second.
import { type RefObject, useEffect, useRef } from 'react';
import {
  SHEET_VELOCITY_WINDOW_MS,
  type SheetClaim,
  type SheetSample,
  sheetClaim,
  sheetOffset,
  sheetShouldClose,
  sheetVelocity,
} from '@/lib/boards/sheet';

/** Tailwind's sm breakpoint, where the sheet becomes a side panel (admin.css). */
const SIDE_PANEL_QUERY = '(min-width: 40rem)';

/** The drag animation maps one ms to one px; no phone is this tall. */
const DRAG_RANGE = 4000;

/** The sheet leaves by this much past its own height, matching the CSS entry. */
const EXIT_OVERSHOOT = 32;

/** A full exit; a sheet already part way down takes proportionally less. */
const EXIT_MS = 300;
const EXIT_MIN_MS = 100;
const SETTLE_MS = 220;

export interface SheetSwipeOptions {
  /** False while the sheet is already on its way out. */
  enabled: boolean;
  /**
   * Asked once a release has committed to closing, while the sheet is
   * animating away: true lets it go, false (a save that failed, a title
   * that is empty) brings it back. Any rejection is a false.
   */
  requestClose: () => Promise<boolean>;
  /** The sheet has left the screen: time to unmount it. */
  onClosed: () => void;
}

export function useSheetSwipe(
  panelRef: RefObject<HTMLElement | null>,
  options: SheetSwipeOptions
): void {
  // The gesture reads the latest options at touch time, not the render the
  // listeners were attached in.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    // Live gesture bookkeeping: nothing here should re-render on its own.
    const gesture = {
      touchId: null as number | null,
      startX: 0,
      startY: 0,
      scrollTop: 0,
      claim: 'wait' as SheetClaim,
      offset: 0,
      samples: [] as SheetSample[],
      drag: null as Animation | null,
    };

    const findTouch = (event: TouchEvent): Touch | null => {
      if (gesture.touchId === null) return null;
      for (const touch of Array.from(event.changedTouches)) {
        if (touch.identifier === gesture.touchId) return touch;
      }
      return null;
    };

    const reset = () => {
      gesture.touchId = null;
      gesture.claim = 'wait';
      gesture.offset = 0;
      gesture.samples = [];
    };

    /** Sits the sheet back at rest from wherever it is, then steps aside. */
    const settle = (from: number) => {
      panel.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(0px)' }], {
        duration: SETTLE_MS,
        easing: 'ease-out',
      });
      gesture.drag?.cancel();
      gesture.drag = null;
    };

    /** Carries the sheet the rest of the way off, and asks whether it may go. */
    const leave = async (from: number) => {
      const distance = panel.offsetHeight + EXIT_OVERSHOOT;
      const duration = Math.max(
        EXIT_MIN_MS,
        Math.round((EXIT_MS * Math.max(0, distance - from)) / distance)
      );
      const exit = panel.animate(
        [{ transform: `translateY(${from}px)` }, { transform: `translateY(${distance}px)` }],
        { duration, easing: 'ease-in', fill: 'forwards' }
      );
      gesture.drag?.cancel();
      gesture.drag = null;
      const [allowed] = await Promise.all([
        latest.current.requestClose().catch(() => false),
        exit.finished.catch(() => undefined),
      ]);
      if (allowed) {
        latest.current.onClosed();
        return;
      }
      // Something kept it: bring it back from off screen, and only then
      // release the exit so there is no frame with the sheet at rest.
      panel.animate(
        [{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0px)' }],
        { duration: SETTLE_MS, easing: 'ease-out' }
      );
      exit.cancel();
    };

    const onTouchStart = (event: TouchEvent) => {
      if (gesture.touchId !== null || event.touches.length !== 1) return;
      if (!latest.current.enabled) return;
      // A side panel is not pulled down; it has the Close button and Escape.
      if (window.matchMedia(SIDE_PANEL_QUERY).matches) return;
      const touch = event.touches[0];
      gesture.touchId = touch.identifier;
      gesture.startX = touch.clientX;
      gesture.startY = touch.clientY;
      gesture.scrollTop = panel.scrollTop;
      gesture.claim = 'wait';
      gesture.offset = 0;
      gesture.samples = [{ t: event.timeStamp, y: touch.clientY }];
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = findTouch(event);
      if (!touch || gesture.claim === 'scroll') return;
      if (event.touches.length !== 1) {
        // A second finger is not a pull; whatever we had goes home.
        if (gesture.drag) settle(gesture.offset);
        gesture.claim = 'scroll';
        return;
      }
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (gesture.claim === 'wait') {
        gesture.claim = sheetClaim(dx, dy, gesture.scrollTop);
        if (gesture.claim !== 'drag') return;
        if (!latest.current.enabled) {
          gesture.claim = 'scroll';
          return;
        }
        // A pull that starts while the sheet is still arriving takes it from
        // its resting place rather than from mid-air.
        for (const animation of panel.getAnimations()) {
          if (animation instanceof CSSAnimation && animation.playState === 'running') {
            animation.finish();
          }
        }
        gesture.drag = panel.animate(
          [{ transform: 'translateY(0px)' }, { transform: `translateY(${DRAG_RANGE}px)` }],
          { duration: DRAG_RANGE, fill: 'both' }
        );
        gesture.drag.pause();
      }
      // Ours: the scroller does not get this move.
      event.preventDefault();
      gesture.offset = sheetOffset(dy);
      if (gesture.drag) gesture.drag.currentTime = Math.min(gesture.offset, DRAG_RANGE);
      gesture.samples.push({ t: event.timeStamp, y: touch.clientY });
      // Keep the path short: only the recent window is ever read.
      while (
        gesture.samples.length > 2 &&
        event.timeStamp - gesture.samples[1].t > SHEET_VELOCITY_WINDOW_MS
      ) {
        gesture.samples.shift();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!findTouch(event)) return;
      if (gesture.claim === 'drag' && gesture.drag) {
        const velocity = sheetVelocity(gesture.samples);
        if (sheetShouldClose(gesture.offset, panel.offsetHeight, velocity)) {
          void leave(gesture.offset);
        } else {
          settle(gesture.offset);
        }
      }
      reset();
    };

    const onTouchCancel = (event: TouchEvent) => {
      if (!findTouch(event)) return;
      // The browser took the touch: the sheet just goes home.
      if (gesture.drag) settle(gesture.offset);
      reset();
    };

    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd, { passive: true });
    panel.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('touchend', onTouchEnd);
      panel.removeEventListener('touchcancel', onTouchCancel);
      gesture.drag?.cancel();
    };
  }, [panelRef]);
}
