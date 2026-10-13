// Editors for the two kinds of lists a journey is made of besides its emails:
// conditions ("has credits left", "has tag X") and tag actions. Each row is a
// plain select plus whatever parameter the choice needs.

import { useId } from 'react';
import {
  CONDITION_TYPES,
  CONDITIONS,
  type Condition,
  type ConditionType,
  type JourneyAction,
} from '@/lib/email/journeys/schema';
import { buttonClass, compactInputClass, compactSelectClass } from './journeyUi';

function conditionValue(c: Condition): string {
  return `${c.type}:${c.negate ? 'not' : 'is'}`;
}

export function ConditionList({
  conditions,
  onChange,
  allowSession,
  tags,
  emptyText,
  addLabel = 'Add condition',
  disabled = false,
}: {
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
  /** Offer conditions that need the booked session (booking-triggered journeys only). */
  allowSession: boolean;
  tags: string[];
  emptyText: string;
  addLabel?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const types = CONDITION_TYPES.filter((t) => allowSession || !CONDITIONS[t].needsSession);

  const update = (index: number, patch: Partial<Condition>) =>
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-1.5">
      <datalist id={listId}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {conditions.length === 0 && <p className="text-xs text-white/40">{emptyText}</p>}
      {conditions.map((c, i) => {
        const meta = CONDITIONS[c.type];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond position
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <select
              className={`${compactSelectClass} min-w-0 flex-1`}
              value={conditionValue(c)}
              disabled={disabled}
              onChange={(e) => {
                const [type, sense] = e.target.value.split(':') as [ConditionType, string];
                update(i, { type, negate: sense === 'not' });
              }}
              title={meta.description}
            >
              {types.flatMap((t) => [
                <option key={`${t}:is`} value={`${t}:is`}>
                  {CONDITIONS[t].label}
                </option>,
                <option key={`${t}:not`} value={`${t}:not`}>
                  {CONDITIONS[t].negatedLabel}
                </option>,
              ])}
            </select>
            {meta.param === 'tag' && (
              <input
                className={`${compactInputClass} w-44`}
                list={listId}
                placeholder="Tag name"
                value={c.tag ?? ''}
                disabled={disabled}
                onChange={(e) => update(i, { tag: e.target.value })}
              />
            )}
            {meta.param === 'count' && (
              <input
                type="number"
                min={0}
                className={`${compactInputClass} w-20`}
                value={c.count ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  update(i, { count: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={disabled}
              onClick={() => onChange(conditions.filter((_, j) => j !== i))}
              aria-label="Remove condition"
            >
              Remove
            </button>
            <p className="w-full text-[11px] text-white/40">{meta.description}</p>
          </div>
        );
      })}
      <button
        type="button"
        className={`${buttonClass} self-start`}
        disabled={disabled}
        onClick={() => onChange([...conditions, { type: types[0], negate: false }])}
      >
        {addLabel}
      </button>
    </div>
  );
}

export function ActionList({
  actions,
  onChange,
  tags,
  emptyText,
  disabled = false,
}: {
  actions: JourneyAction[];
  onChange: (next: JourneyAction[]) => void;
  tags: string[];
  emptyText: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const update = (index: number, patch: Partial<JourneyAction>) =>
    onChange(actions.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  return (
    <div className="flex flex-col gap-1.5">
      <datalist id={listId}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {actions.length === 0 && <p className="text-xs text-white/40">{emptyText}</p>}
      {actions.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond position
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <select
            className={compactSelectClass}
            value={a.type}
            disabled={disabled}
            onChange={(e) => update(i, { type: e.target.value as JourneyAction['type'] })}
          >
            <option value="add-tag">Add Momence tag</option>
            <option value="remove-tag">Remove Momence tag</option>
          </select>
          <input
            className={`${compactInputClass} min-w-0 flex-1`}
            list={listId}
            placeholder="Tag name, exactly as in Momence"
            value={a.tag}
            disabled={disabled}
            onChange={(e) => update(i, { tag: e.target.value })}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={disabled}
            onClick={() => onChange(actions.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className={`${buttonClass} self-start`}
        disabled={disabled}
        onClick={() => onChange([...actions, { type: 'add-tag', tag: '' }])}
      >
        Add tag action
      </button>
    </div>
  );
}

/** A list of tag names, edited as comma-separated text. */
export function TagListInput({
  value,
  onChange,
  tags,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  tags: string[];
  placeholder: string;
}) {
  const listId = useId();
  return (
    <>
      <datalist id={listId}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <input
        className={`${compactInputClass} w-full`}
        list={listId}
        placeholder={placeholder}
        defaultValue={value.join(', ')}
        onBlur={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          )
        }
      />
    </>
  );
}
