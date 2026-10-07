// Making a board: its name and address, what one card is called, the
// section it sits in, and the goal it serves — a new one written here, one
// nobody serves yet, or none. Opened from New board beside the view pills
// (CreateActions); the board's KPIs and columns are set up on the board.

import { type FormEvent, useState } from 'react';
import { formButtonClass } from '@/components/admin/ui';
import type { Assignable } from '@/lib/boards/people';
import { sectionsInOrder } from '@/lib/boards/sections';
import { BOARD_LIMITS, slugOf } from '@/lib/boards/types';
import { sendJson } from '@/lib/client/api';
import type { BoardRow, BoardSectionRow, GoalRow } from '@/lib/db';
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
  selectClass,
} from '../goalsUi';

// What a brand-new board starts with. Every board needs somewhere open to
// put a card and somewhere to finish it; the rest is the owner's to add.
const STARTER_COLUMNS = [
  { key: 'new', label: 'New', kind: 'open', sortOrder: 10 },
  { key: 'in_progress', label: 'In progress', kind: 'open', sortOrder: 20 },
  { key: 'done', label: 'Done', kind: 'done', sortOrder: 30 },
];

/** The goal picker's two fixed choices, ahead of the goals nobody serves yet. */
const NO_GOAL = '';
const NEW_GOAL = '__new__';

export function NewBoardForm({
  sections,
  unattached,
  owners,
  className = cardClass,
  headingId,
  onCreated,
  onCancel,
}: {
  sections: BoardSectionRow[];
  /** Goals no board serves yet, offered as this board's goal. */
  unattached: GoalRow[];
  owners: Assignable[];
  className?: string;
  headingId?: string;
  /** Called with the new board's slug. */
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [cardNoun, setCardNoun] = useState('task');
  const [includeInAllTasks, setIncludeInAllTasks] = useState(true);
  const [sectionId, setSectionId] = useState('');
  const [goalChoice, setGoalChoice] = useState<string>(NEW_GOAL);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalOwner, setGoalOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [_error, setError] = useState<string | null>(null);

  const suggested = slugTouched ? slug : slugOf(name);
  const needsGoalTitle = goalChoice === NEW_GOAL && !goalTitle.trim();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const goal =
        goalChoice === NEW_GOAL
          ? {
              goal: {
                title: goalTitle,
                targetDate: goalTarget || null,
                ownerEmail: goalOwner || null,
                status: 'active',
              },
            }
          : goalChoice === NO_GOAL
            ? {}
            : { goalId: goalChoice };
      const { board } = await sendJson<{ board: BoardRow }>('/api/admin/boards', 'POST', {
        name,
        slug: slug || slugOf(name),
        cardNoun,
        includeInAllTasks,
        sectionId: sectionId || null,
        ...goal,
        columns: STARTER_COLUMNS,
      });
      onCreated(board.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that board');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className={className}>
      <SectionTitle id={headingId}>New board</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="new-board-name">
            Name
          </label>
          <input
            id="new-board-name"
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-board-slug">
            URL name
          </label>
          <input
            id="new-board-slug"
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.slug}
            placeholder={slugOf(name) || 'group-bookings'}
            value={suggested}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
          <p className="mt-1 text-xs text-white/35">
            Permanent: it is the address and the grant key (board:{suggested || '…'}).
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="new-board-noun">
            One card is a…
          </label>
          <input
            id="new-board-noun"
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.cardNoun}
            value={cardNoun}
            onChange={(e) => setCardNoun(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-board-section">
            Section
          </label>
          <select
            id="new-board-section"
            className={selectClass}
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">Other boards</option>
            {sectionsInOrder(sections).map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="new-board-goal">
            Goal
          </label>
          <select
            id="new-board-goal"
            className={selectClass}
            value={goalChoice}
            onChange={(e) => setGoalChoice(e.target.value)}
          >
            <option value={NEW_GOAL}>Write a new goal</option>
            <option value={NO_GOAL}>No goal — it is just a list</option>
            {unattached.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {goalChoice === NEW_GOAL && (
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="new-board-goal-title">
              What is this board for?
            </label>
            <input
              id="new-board-goal-title"
              className={inputClass}
              type="text"
              maxLength={200}
              placeholder="Ten private rentals booked by December"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
            />
            <p className="mt-1 text-xs text-white/35">
              The KPIs that say whether it worked come next, on the board.
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="new-board-goal-target">
              Target date
            </label>
            <input
              id="new-board-goal-target"
              className={inputClass}
              type="date"
              value={goalTarget}
              onChange={(e) => setGoalTarget(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-board-goal-owner">
              Who is driving it
            </label>
            <select
              id="new-board-goal-owner"
              className={selectClass}
              value={goalOwner}
              onChange={(e) => setGoalOwner(e.target.value)}
            >
              <option value="">Nobody yet</option>
              {owners.map((owner) => (
                <option key={owner.email} value={owner.email}>
                  {owner.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={includeInAllTasks}
          onChange={(e) => setIncludeInAllTasks(e.target.checked)}
        />
        Show these cards on All Tasks
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={formButtonClass} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={busy || !name.trim() || !suggested || needsGoalTitle}
        >
          {busy ? 'Creating…' : 'Create board'}
        </button>
      </div>
      <p className="mt-2 text-xs text-white/35">
        It starts with New / In progress / Done — rename them, add your own, on the board.
      </p>
    </form>
  );
}
