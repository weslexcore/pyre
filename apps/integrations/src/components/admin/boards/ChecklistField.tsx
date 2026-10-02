// A checklist field, opened in the card drawer: the shared Checklist (the
// same rows, skips, required items and swipes as an SOP run) bound to the
// card's answer. Until somebody taps, the card shows the field's default
// list; the first tap stores the card's own copy (lib/boards/checklist.ts).
//
// "Edit list" rewrites this card's copy only — the default is the board's,
// and lives in its settings. Marks follow their items by text through an
// edit, so adding a step halfway through keeps what was already done.
//
// Finishing the list calls `onComplete`, which is where the drawer moves the
// card to the field's column, if it names one. The route makes the same
// move on the same save, so the card lands there even if the drawer closes
// before the tap's effect runs.

import { useMemo, useState } from 'react';
import { formButtonClass } from '@/components/admin/ui';
import {
  checklistDone,
  checklistOf,
  editChecklist,
  marksOf,
  toggleChecklist,
} from '@/lib/boards/checklist';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardFieldRow, BoardFieldValue, ChecklistAnswer } from '@/lib/db';
import { parseChecklist } from '@/lib/sops/checklist';
import type { PeopleNames } from '@/lib/sops/names';
import type { CheckItems } from '@/lib/sops/optimistic';
import { Checklist } from '../Checklist';
import { textareaClass } from '../goalsUi';

export function ChecklistField({
  id,
  field,
  value,
  people,
  viewerEmail,
  destination,
  disabled = false,
  onChange,
  onComplete,
}: {
  id: string;
  field: BoardFieldRow;
  value: BoardFieldValue | null | undefined;
  people: PeopleNames;
  /** Stamped on a tap until the server's own stamp comes back. */
  viewerEmail: string;
  /** The label of the column a finished card moves to, when the field names a live one. */
  destination?: string;
  disabled?: boolean;
  /**
   * The card's new answer. `immediate` for a tap (save it now); an edit to
   * the list's text is typing, and waits for a pause.
   */
  onChange: (next: ChecklistAnswer | null, immediate: boolean) => void;
  onComplete?: () => void;
}) {
  const answer = useMemo(() => checklistOf(field, value), [field, value]);
  const marks = useMemo(() => marksOf(answer), [answer]);
  const total = useMemo(() => parseChecklist(answer.md).tasks.length, [answer.md]);
  const done = checklistDone(answer);
  // The text being edited, held here: an emptied list clears the answer and
  // the card falls back to the default, which must not jump into the box
  // under somebody's cursor.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const own = value != null && answer.md !== field.checklist_md;

  const toggle = (items: CheckItems, checked: boolean) =>
    onChange(toggleChecklist(answer, items, checked, viewerEmail, new Date().toISOString()), true);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {total > 0 && (
          <span
            className={`font-mono text-[10px] uppercase tracking-wide ${
              done ? 'text-[var(--pyre-sage)]' : 'text-white/50'
            }`}
          >
            {done ? 'Done' : `${marks.length} of ${total}`}
          </span>
        )}
        {destination && (
          <span className="font-mono text-[10px] text-white/35">
            {done ? `moved to ${destination}` : `moves to ${destination} when done`}
          </span>
        )}
        {!disabled && (
          <span className="ml-auto flex gap-2">
            {own && !editing && (
              <button
                type="button"
                className={formButtonClass}
                // Back to the board's list, starting over on it.
                onClick={() => onChange(null, true)}
              >
                Reset to default
              </button>
            )}
            <button
              type="button"
              className={formButtonClass}
              aria-controls={`${id}-md`}
              aria-expanded={editing}
              onClick={() => setDraft(editing ? null : answer.md)}
            >
              {editing ? 'Done editing' : 'Edit list'}
            </button>
          </span>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            id={`${id}-md`}
            className={`${textareaClass} font-mono text-xs`}
            rows={Math.min(14, Math.max(5, draft.split('\n').length + 1))}
            maxLength={BOARD_LIMITS.checklist}
            value={draft}
            placeholder={'- [ ] An item\n- [!] An item that must be done, never skipped'}
            onChange={(e) => {
              setDraft(e.target.value);
              onChange(e.target.value.trim() ? editChecklist(answer, e.target.value) : null, false);
            }}
          />
          <p className="text-xs text-white/35">
            Changes this card only. “- [ ]” for an item, “- [!]” for one that must be checked off
            and can’t be skipped; indent two spaces to nest. Items that keep their words keep their
            ticks.
          </p>
        </>
      ) : total === 0 ? (
        <p id={id} className="text-xs text-white/35">
          No items yet{disabled ? '.' : ' — edit the list to add some.'}
        </p>
      ) : (
        <div id={id}>
          <Checklist
            content={answer.md}
            marks={marks}
            people={people}
            locked={disabled}
            frameClassName="rounded border border-white/10 bg-white/[0.03] px-3 py-1"
            onToggle={toggle}
            onComplete={onComplete}
          />
        </div>
      )}
    </div>
  );
}
