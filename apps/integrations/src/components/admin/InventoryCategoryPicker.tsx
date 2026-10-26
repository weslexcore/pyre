// The category drop-down on /admin/inventory — in a row's Category cell and
// in the details dialog. It offers every category already in use, "None",
// and, last, "Add new category", which swaps the drop-down for a text box:
// Enter (or clicking away) keeps the new name, Escape goes back. Categories
// are plain text on the item, so a new one exists as soon as an item has it.

import { useState } from 'react';

const ADD_NEW = '\u0000add';
const MAX_CATEGORY = 60;

export function CategoryPicker({
  value,
  categories,
  onChange,
  label,
  selectClassName,
  inputClassName,
  id,
}: {
  value: string | null;
  /** Categories already in use, sorted. */
  categories: readonly string[];
  /** Called with the chosen or newly typed category (null = none). */
  onChange: (next: string | null) => void;
  label: string;
  selectClassName: string;
  inputClassName: string;
  id?: string;
}) {
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
        // biome-ignore lint/a11y/noAutofocus: shown only after choosing "Add new category"
        autoFocus
        value={draft}
        maxLength={MAX_CATEGORY}
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
        placeholder="New category name"
        aria-label={`New category for ${label}`}
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
      <option value={ADD_NEW}>Add new category…</option>
    </select>
  );
}
