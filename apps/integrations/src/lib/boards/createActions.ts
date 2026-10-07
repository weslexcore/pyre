// The New task / New board / New goal actions that sit beside the view pills
// on every cross-board page (BoardsTabs.astro), so any of them can be made
// from wherever the person is.
//
//   * New task opens global search on its Create task form (CREATE_TASK_EVENT);
//     that form works over any page.
//   * New board and New goal are links to the page that owns the form — the
//     boards index and All goals — with ?new=<kind>. A click is first offered
//     to the page as a cancelable CREATE_EVENT: the page already holding the
//     form opens it in place and cancels, so nothing reloads. Anywhere else
//     the link navigates, and the owning page opens the form from the query.

import { useEffect, useRef } from 'react';
import { CREATE_TASK_EVENT } from '@/lib/admin/globalSearch';
import { ALL_GOALS_HREF } from '@/lib/goals/types';
import { BOARDS_HREF } from './types';

export type CreateKind = 'board' | 'goal';

export const CREATE_EVENT = 'admin:create';
const CREATE_PARAM = 'new';

export const CREATE_HREFS: Record<CreateKind, string> = {
  board: `${BOARDS_HREF}?${CREATE_PARAM}=board`,
  goal: `${ALL_GOALS_HREF}?${CREATE_PARAM}=goal`,
};

function isCreateKind(value: string | undefined): value is CreateKind {
  return value === 'board' || value === 'goal';
}

/**
 * Wires the action buttons. Capture phase, so a claimed link is cancelled
 * before the ClientRouter's own handler (which skips a prevented click) sees
 * it. Bound once per JS realm by BoardsTabs' script.
 */
export function bindCreateActions() {
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-create-task]')) {
        window.dispatchEvent(new Event(CREATE_TASK_EVENT));
        return;
      }
      const kind = target?.closest<HTMLElement>('a[data-create]')?.dataset.create;
      if (!isCreateKind(kind)) return;
      const claimed = !window.dispatchEvent(
        new CustomEvent<CreateKind>(CREATE_EVENT, { detail: kind, cancelable: true })
      );
      if (claimed) event.preventDefault();
    },
    true
  );
}

/**
 * Opens this page's form for `kind`: on arrival with ?new=<kind> (which is
 * then dropped from the address), and on a claimed click while here.
 */
export function useCreateRequest(kind: CreateKind, open: () => void) {
  const latest = useRef(open);
  latest.current = open;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(CREATE_PARAM) === kind) {
      url.searchParams.delete(CREATE_PARAM);
      window.history.replaceState(window.history.state, '', url);
      latest.current();
    }
    const onCreate = (event: Event) => {
      if ((event as CustomEvent<CreateKind>).detail !== kind) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener(CREATE_EVENT, onCreate);
    return () => window.removeEventListener(CREATE_EVENT, onCreate);
  }, [kind]);
}
