// The category and location drop-downs on /admin/inventory — in a row's
// cells and in the details dialog. It offers every value already in use,
// "None", and, last, "Add new category" (or "area"), which swaps the
// drop-down for a text box: Enter (or clicking away) keeps the new name,
// Escape goes back. Both are plain text on the item, so a new one exists as
// soon as an item has it.

import { useState } from 'react';

const ADD_NEW = '\u0000add';
const MAX_CATEGORY = 60;
const MAX_LOCATION = 120;

/** What the picker chooses, for its wording and length limit. */
const KINDS = {
  category: { noun: 'category', max: MAX_CATEGORY },
  location: { noun: 'area', max: MAX_LOCATION },
} as const;

export function CategoryPicker({
  value,
  categories,
  onChange,
  label,
  selectClassName,
  inputClassName,
  id,
  kind = 'category',
}: {
  value: string | null;
  /** Values already in use, sorted. */
  categories: readonly string[];
  /** Called with the chosen or newly typed value (null = none). */
  onChange: (next: string | null) => void;
  label: string;
  selectClassName: string;
  inputClassName: string;
  id?: string;
  kind?: keyof typeof KINDS;
}) {
  const { noun, max } = KINDS[kind];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  if (adding) {
    const finish = (keep: boolean) => {
      const name = draft.trim();
      setAdding(false);
      setDraft('');
      if (keep && name && name !== value) onChange(name);
    };
    return (
      <input
        id={id}
        // biome-ignore lint/a11y/noAutofocus: shown only after choosing "Add new …"
        autoFocus
        value={draft}
        maxLength={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            finish(false);
          }
        }}
        placeholder={`New ${noun} name`}
        aria-label={`New ${noun} for ${label}`}
        className={inputClassName}
      />
    );
  }

  // A value no longer in the list (only possible mid-save) still shows.
  const options = value && !categories.includes(value) ? [...categories, value] : categories;
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === ADD_NEW) setAdding(true);
        else onChange(e.target.value || null);
      }}
      aria-label={label}
      className={selectClassName}
    >
      <option value="">None</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value={ADD_NEW}>Add new {noun}…</option>
    </select>
  );
}
