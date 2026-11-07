// A markdown textarea where typing `@` offers the people who can read what
// is being written — a message's audience, a note's readers, a board's
// holders (lib/mentions decides who; the caller fetches them). Picking one
// writes `@<email> ` into the text, which the server reads back as the
// mention (and notifies) and the page draws as the person's name. Sits on
// LinkTextarea, so markdown links keep their own page picker: the key
// handler here runs only for keys that picker didn't take.
//
// Arrow keys move, Enter or Tab picks, Escape hides the list until the next
// `@`. Used by every conversation field in the dashboard: message bodies and
// replies, shift notes and their replies, card and goal comments, incident
// follow-up notes.
import { type ComponentProps, useCallback, useRef, useState } from 'react';
import { type MentionPerson, matchMentions, mentionQuery, mentionToken } from '@/lib/mentions';
import { LinkTextarea } from './LinkTextarea';

type Props = Omit<ComponentProps<typeof LinkTextarea>, 'onChange'> & {
  onChange: (value: string) => void;
  /** Who may be named here. Empty draws a plain textarea. */
  people: readonly MentionPerson[];
};

export function MentionTextarea({
  id,
  value,
  onChange,
  people,
  disabled,
  maxLength,
  onBlur,
  onFocus,
  onSelect,
  onKeyDown,
  ref: outerRef,
  ...rest
}: Props) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  // The textarea is needed here (to place the caret after a pick) and by a
  // host that focuses it (the quick-add modal), so one ref feeds both.
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      input.current = el;
      if (typeof outerRef === 'function') outerRef(el);
      else if (outerRef) outerRef.current = el;
    },
    [outerRef]
  );
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = mentionQuery(value, caret);
  const matches = query && !dismissed && !disabled ? matchMentions(people, query.query) : [];
  const selected = Math.min(active, Math.max(matches.length - 1, 0));
  const listId = id ? `${id}-mentions` : undefined;

  const choose = (person: MentionPerson) => {
    if (!query) return;
    const token = mentionToken(person);
    const next = value.slice(0, query.start) + token + value.slice(caret);
    if (maxLength !== undefined && next.length > maxLength) return;
    onChange(next);
    setDismissed(true);
    const position = query.start + token.length;
    setCaret(position);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  };

  return (
    <div className="relative">
      <LinkTextarea
        {...rest}
        ref={setRef}
        id={id}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        aria-autocomplete={people.length > 0 ? 'list' : undefined}
        aria-controls={matches.length && listId ? listId : undefined}
        aria-activedescendant={matches.length && listId ? `${listId}-${selected}` : undefined}
        onBlur={(event) => {
          setDismissed(true);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setDismissed(false);
          onFocus?.(event);
        }}
        onSelect={(event) => {
          setCaret(event.currentTarget.selectionStart);
          onSelect?.(event);
        }}
        onChange={(next, event) => {
          onChange(next);
          if (event) setCaret(event.target.selectionStart);
          setActive(0);
          setDismissed(false);
        }}
        onKeyDown={(event) => {
          if (!matches.length || event.nativeEvent.isComposing) {
            onKeyDown?.(event);
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setDismissed(true);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(
              (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
            );
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            choose(matches[selected]);
          } else {
            onKeyDown?.(event);
          }
        }}
      />
      {matches.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="absolute z-20 max-h-60 w-full overflow-auto rounded border border-white/20 bg-[var(--pyre-black)] p-1 shadow-lg"
        >
          {matches.map((person, index) => (
            <button
              key={person.email}
              id={listId ? `${listId}-${index}` : undefined}
              role="option"
              aria-selected={index === selected}
              type="button"
              tabIndex={-1}
              className={`w-full rounded px-3 py-2 text-left text-sm ${index === selected ? 'bg-white/15' : 'hover:bg-white/10'}`}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(person)}
            >
              <span className="block text-white">{person.name}</span>
              <span className="block text-xs text-white/50">{person.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
