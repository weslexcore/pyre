// How long after it is made a new card on this board is due — "2 hours",
// "1 week" — or not at all. Saved with the rest of the board settings; the
// insert trigger (board_cards_default_due) applies it to every new card, so
// the preview here uses the same arithmetic (lib/boards/default-due.ts).

import { useId, useState } from 'react';
import {
  DEFAULT_DUE_EVERY_MAX,
  DEFAULT_DUE_PRESETS,
  DEFAULT_DUE_UNITS,
  type DefaultDueRule,
  type DefaultDueUnit,
  defaultDueDate,
} from '@/lib/boards/default-due';
import { inputBaseClass, labelClass, selectBaseClass } from '../goalsUi';

/** Which choice a rule is: a preset's index, 'custom', or 'none'. */
function choiceOf(rule: DefaultDueRule | null): string {
  if (!rule) return 'none';
  const index = DEFAULT_DUE_PRESETS.findIndex(
    (preset) => preset.rule.every === rule.every && preset.rule.unit === rule.unit
  );
  return index >= 0 ? String(index) : 'custom';
}

function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function DefaultDueSetting({
  value,
  nounPlural,
  onChange,
}: {
  value: DefaultDueRule | null;
  /** What the board calls its cards — 'tasks', 'leads'. */
  nounPlural: string;
  onChange: (next: DefaultDueRule | null) => void;
}) {
  const id = useId();
  const [custom, setCustom] = useState(() => choiceOf(value) === 'custom');
  const choice = custom ? 'custom' : choiceOf(value);
  // The count as typed, so clearing the box to type a new number doesn't snap back.
  const [everyText, setEveryText] = useState(String(value?.every ?? 3));

  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        New {nounPlural} are due
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={id}
          className={`${selectBaseClass} w-auto max-w-full`}
          value={choice}
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'none') {
              setCustom(false);
              onChange(null);
            } else if (next === 'custom') {
              setCustom(true);
              const rule = value ?? { every: 3, unit: 'day' };
              setEveryText(String(rule.every));
              onChange(rule);
            } else {
              setCustom(false);
              onChange(DEFAULT_DUE_PRESETS[Number(next)].rule);
            }
          }}
        >
          <option value="none">No due date</option>
          {DEFAULT_DUE_PRESETS.map((preset, index) => (
            <option key={preset.label} value={String(index)}>
              {preset.label} after it's added
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {custom && value && (
          <div className="flex items-center gap-2 font-mono text-xs text-white/60">
            <input
              aria-label="Due after"
              className={`${inputBaseClass} w-16`}
              type="number"
              min={1}
              max={DEFAULT_DUE_EVERY_MAX}
              value={everyText}
              onChange={(e) => {
                setEveryText(e.target.value);
                const every = Number(e.target.value);
                if (!Number.isInteger(every) || every < 1 || every > DEFAULT_DUE_EVERY_MAX) return;
                onChange({ ...value, every });
              }}
            />
            <select
              aria-label="Due after unit"
              className={`${selectBaseClass} w-auto`}
              value={value.unit}
              onChange={(e) => onChange({ ...value, unit: e.target.value as DefaultDueUnit })}
            >
              {DEFAULT_DUE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {value.every === 1 ? unit : `${unit}s`}
                </option>
              ))}
            </select>
            <span>after it's added</span>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-white/35">
        {value
          ? `Added now, one would be due ${formatYmd(defaultDueDate(value))}. Due dates are days, so hours count to the day the deadline lands on. Whoever adds one can still pick another date.`
          : `New ${nounPlural} start without a due date unless whoever adds one picks a date.`}
      </p>
    </div>
  );
}
