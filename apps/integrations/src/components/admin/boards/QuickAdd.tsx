// One line, one button, one card. The quick-add exists so that writing
// something down costs a sentence and nothing else: no dialog, no required
// owner, no date. Everything else about the card can be filled in later from
// the drawer, and most of it never will be, which is fine.

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { BOARD_LIMITS } from '@/lib/boards/types';
import { buttonClass, inputBaseClass } from '../goalsUi';

export function QuickAdd({
  noun,
  placeholder,
  busy = false,
  focusOnMount = false,
  onAdd,
  onCancel,
}: {
  /** What this board calls a card — 'task', 'lead'. */
  noun: string;
  placeholder?: string;
  busy?: boolean;
  /** For a form that appears on demand, so typing can start at once. */
  focusOnMount?: boolean;
  onAdd: (title: string) => Promise<void>;
  /** When given, Escape in the field calls it — how an on-demand form closes. */
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onAdd(trimmed);
      // Cleared only on success, so a failed save doesn't lose what was typed.
      setTitle('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        ref={inputRef}
        className={`${inputBaseClass} min-w-0 flex-1`}
        type="text"
        maxLength={BOARD_LIMITS.title}
        placeholder={placeholder ?? `Add a ${noun}…`}
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
        aria-label={`Add a ${noun}`}
      />
      <button type="submit" className={buttonClass} disabled={busy || saving || !title.trim()}>
        {saving ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}
