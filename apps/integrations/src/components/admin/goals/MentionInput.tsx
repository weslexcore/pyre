import { useRef, useState } from 'react';
import { type MentionPerson, mentionQuery } from '@/lib/boards/mentions';
import { BOARD_LIMITS } from '@/lib/boards/types';
import { textareaClass } from '../goalsUi';

export function MentionInput({
  id,
  value,
  onChange,
  people,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  people: MentionPerson[];
  disabled: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = mentionQuery(value, caret);
  const matches =
    query && !dismissed && !disabled
      ? people
          .filter((person) => `${person.name} ${person.email}`.toLowerCase().includes(query.query))
          .slice(0, 8)
      : [];
  const selected = Math.min(active, Math.max(matches.length - 1, 0));
  const choose = (person: MentionPerson) => {
    if (!query) return;
    const token = `@${person.email} `;
    const next = value.slice(0, query.start) + token + value.slice(caret);
    if (next.length > BOARD_LIMITS.comment) return;
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
      <textarea
        ref={input}
        id={id}
        className={`${textareaClass} min-h-[70px]`}
        maxLength={BOARD_LIMITS.comment}
        placeholder="Add a comment… Type @ to mention someone"
        value={value}
        disabled={disabled}
        aria-autocomplete="list"
        aria-controls={matches.length ? `${id}-mentions` : undefined}
        aria-activedescendant={matches.length ? `${id}-mention-${selected}` : undefined}
        onBlur={() => setDismissed(true)}
        onFocus={() => setDismissed(false)}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setActive(0);
          setDismissed(false);
        }}
        onKeyDown={(event) => {
          if (!matches.length || event.nativeEvent.isComposing) return;
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
          }
        }}
      />
      {matches.length > 0 && (
        <div
          id={`${id}-mentions`}
          role="listbox"
          aria-label="Mention a user"
          className="absolute z-20 max-h-60 w-full overflow-auto rounded border border-white/20 bg-[var(--pyre-black)] p-1 shadow-lg"
        >
          {matches.map((person, index) => (
            <button
              key={person.email}
              id={`${id}-mention-${index}`}
              role="option"
              aria-selected={index === selected}
              type="button"
              tabIndex={-1}
              className={`w-full rounded px-3 py-2 text-left text-sm ${index === selected ? 'bg-white/15' : 'hover:bg-white/10'}`}
              onPointerDown={(event) => event.preventDefault()}
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
