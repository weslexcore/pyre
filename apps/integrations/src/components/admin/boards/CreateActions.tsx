// New task, New board, and New goal: the actions on the right of the row
// above every cross-board page (BoardsTabs.astro). Each opens its form in a
// dialog over the page the person is on (lib/boards/createActions).
//
// The board and goal forms need the sections, the goals nobody serves yet,
// and the people a goal can be given to; the boards API hands all three to
// anyone who may make either, so the dialog loads them when it opens.

import { navigate } from 'astro:transitions/client';
import { useEffect, useId, useState } from 'react';
import { CREATE_TASK_EVENT } from '@/lib/admin/globalSearch';
import { GOAL_CREATED_EVENT } from '@/lib/boards/createActions';
import type { Assignable } from '@/lib/boards/people';
import { BOARDS_HREF } from '@/lib/boards/types';
import { readError, sendJson } from '@/lib/client/api';
import type { BoardSectionRow, GoalRow } from '@/lib/db';
import { ALL_GOALS_HREF, goalOverviewHref } from '@/lib/goals/types';
import { GoalForm } from '../goals/GoalForm';
import { primaryButtonClass } from '../goalsUi';
import { Modal, modalPanelClass } from '../Modal';
import { NewBoardForm } from './NewBoardForm';

type Kind = 'board' | 'goal';

interface FormData {
  sections: BoardSectionRow[];
  unattachedGoals?: GoalRow[];
  owners?: Assignable[];
}

export function CreateActions({ canManage }: { canManage: boolean }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [data, setData] = useState<FormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  // Fresh on every open: a goal written a moment ago is no longer unattached
  // once a board serves it, and a section may have been added.
  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/admin/boards', { signal: controller.signal });
        if (!res.ok) throw new Error(await readError(res));
        setData((await res.json()) as FormData);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Could not load the form');
      }
    })();
    return () => controller.abort();
  }, [open]);

  const close = () => setOpen(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={primaryButtonClass}
        onClick={() => window.dispatchEvent(new Event(CREATE_TASK_EVENT))}
      >
        New task
      </button>
      {canManage && (
        <>
          <button type="button" className={primaryButtonClass} onClick={() => setOpen('board')}>
            New board
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => setOpen('goal')}>
            New goal
          </button>
        </>
      )}

      {open && (
        <Modal
          labelledBy={headingId}
          onClose={close}
          panelClassName={`max-h-[90vh] max-w-2xl overflow-y-auto ${modalPanelClass}`}
        >
          {!data ? (
            <div className="p-5">
              <h2 id={headingId} className="sr-only">
                {open === 'board' ? 'New board' : 'New goal'}
              </h2>
              <p
                className={
                  error ? 'text-sm text-[var(--pyre-red)]' : 'font-mono text-xs text-white/40'
                }
              >
                {error ?? 'Loading…'}
              </p>
            </div>
          ) : open === 'board' ? (
            <NewBoardForm
              className="p-5"
              headingId={headingId}
              sections={data.sections}
              unattached={data.unattachedGoals ?? []}
              owners={data.owners ?? []}
              onCancel={close}
              onCreated={(slug) => {
                close();
                void navigate(`${BOARDS_HREF}/${slug}`);
              }}
            />
          ) : (
            <GoalForm
              className="p-5"
              headingId={headingId}
              owners={data.owners ?? []}
              onCancel={close}
              onSave={async (values) => {
                const { goal } = await sendJson<{ goal: GoalRow }>(
                  '/api/admin/goals',
                  'POST',
                  values
                );
                close();
                // All goals opens it in place; anywhere else, go there.
                if (window.location.pathname === ALL_GOALS_HREF) {
                  window.dispatchEvent(
                    new CustomEvent<string>(GOAL_CREATED_EVENT, { detail: goal.id })
                  );
                } else {
                  void navigate(goalOverviewHref(goal.id));
                }
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
