// The red loading bar on the bottom edge of the admin header. Anything that
// keeps the person waiting holds it: the ClientRouter while it fetches the
// next document (AdminLayout), and a view while it fetches the data it
// needs before it can draw anything (useLoadingBar). The holds are counted,
// so the bar stays up until the last one lets go.
//
// A hold that ends inside SHOW_DELAY_MS never shows the bar, so prefetched
// pages and warm caches don't flash it. Once the bar is up, letting go waits
// HIDE_GRACE_MS before taking it down: a view hydrating just after the router
// swaps the page picks the bar up where the router left off, and the
// person sees one bar from click to content instead of two.
import { useEffect } from 'react';

const SHOW_DELAY_MS = 250;
const HIDE_GRACE_MS = 150;

let holds = 0;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function setShown(on: boolean) {
  document.documentElement.toggleAttribute('data-admin-loading', on);
}

function isShown() {
  return document.documentElement.hasAttribute('data-admin-loading');
}

/** Holds the bar until the returned release is called (once). */
export function holdLoadingBar(): () => void {
  holds += 1;
  clearTimeout(hideTimer);
  if (!isShown() && showTimer === undefined) {
    showTimer = setTimeout(() => {
      showTimer = undefined;
      if (holds > 0) setShown(true);
    }, SHOW_DELAY_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds > 0) return;
    clearTimeout(showTimer);
    showTimer = undefined;
    if (!isShown()) return;
    hideTimer = setTimeout(() => {
      if (holds === 0) setShown(false);
    }, HIDE_GRACE_MS);
  };
}

/** Holds the bar while `active` (a view's first load) is true. */
export function useLoadingBar(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return holdLoadingBar();
  }, [active]);
}
