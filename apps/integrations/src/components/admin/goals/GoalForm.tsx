// Writing a goal down. Title first and everything else optional, because the
// moment a goal is worth having is usually the moment somebody says it out
// loud — the owner, the date, and the KPIs can follow. Lives on the board
// the goal is for.

import { type FormEvent, useState } from 'react';
import type { Assignable } from '@/lib/boards/people';
import type { GoalRow } from '@/lib/db';
import type { GoalStatusValue } from '@/lib/goals/types';
import {
  AREAS,
  GOAL_LIMITS,
  GOAL_STATUS_HINTS,
  GOAL_STATUS_LABELS,
  GOAL_STATUSES,
} from '@/lib/goals/types';
import {
  buttonClass,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
  selectClass,
  textareaClass,
} from '../goalsUi';

export function GoalForm({
  goal,
  owners,
  busy = false,
  heading,
  onSave,
  onCancel,
}: {
  /** The goal being edited, or undefined for a new one. */
  goal?: GoalRow;
  owners: Assignable[];
  /** Overrides "Edit goal" / "New goal". */
  heading?: string;
  busy?: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description_md ?? '');
  const [status, setStatus] = useState<GoalStatusValue>(
    (goal?.status as GoalStatusValue) ?? 'planned'
  );
  const [ownerEmail, setOwnerEmail] = useState(goal?.owner_email ?? '');
  const [area, setArea] = useState(goal?.area ?? '');
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A goal can be created planned or active, never completed: completion
  // carries a name and a note, and both come from the dedicated dialog.
  const statuses = goal
    ? GOAL_STATUSES.filter((option) => option !== 'completed' || goal.status === 'completed')
    : GOAL_STATUSES.filter((option) => option !== 'completed');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title,
        descriptionMd: description,
        status,
        ownerEmail: ownerEmail || null,
        area: area || null,
        targetDate: targetDate || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that goal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={cardClass}>
      <SectionTitle>{heading ?? (goal ? 'Edit goal' : 'New goal')}</SectionTitle>

      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="goal-title">
            What are we trying to achieve?
          </label>
          <input
            id="goal-title"
            className={inputClass}
            type="text"
            maxLength={GOAL_LIMITS.title}
            placeholder="Train the staff to run the space without our intervention"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="goal-status">
              Status
            </label>
            <select
              id="goal-status"
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as GoalStatusValue)}
            >
              {statuses.map((option) => (
                <option key={option} value={option}>
                  {GOAL_STATUS_LABELS[option]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-white/35">{GOAL_STATUS_HINTS[status]}</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="goal-owner">
              Who is driving it
            </label>
            <select
              id="goal-owner"
              className={selectClass}
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
            >
              <option value="">Nobody yet</option>
              {owners.map((owner) => (
                <option key={owner.email} value={owner.email}>
                  {owner.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="goal-target">
              Target date
            </label>
            <input
              id="goal-target"
              className={inputClass}
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="goal-area">
              Area
            </label>
            <select
              id="goal-area"
              className={selectClass}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="">None</option>
              {AREAS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="goal-description">
            What does good look like?
          </label>
          <textarea
            id="goal-description"
            className={textareaClass}
            maxLength={GOAL_LIMITS.description}
            placeholder="Markdown is fine here."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={buttonClass} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={busy || saving || !title.trim()}
        >
          {saving ? 'Saving…' : goal ? 'Save goal' : 'Create goal'}
        </button>
      </div>
    </form>
  );
}
