// A searchable single-select: type to narrow a list, pick with the mouse or
// arrow keys and Enter. Replaces a plain <select> anywhere the list is long
// enough to scan (events, blog posts).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputClass } from './incidentUi';

export interface SearchOption {
  value: string;
  label: string;
  /** Secondary text, searched too. */
  hint?: string;
}

function matches(option: SearchOption, query: string): boolean {
  const haystack = `${option.label} ${option.hint ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function SearchSelect({
  id,
  options,
  value,
  onChange,
  placeholder = 'Type to search',
  emptyText = 'Nothing matches',
}: {
  id: string;
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(
    () => (query ? options.filter((o) => matches(o, query)) : options),
    [options, query]
  );

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.children[active] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    []
  );

  const pick = (option: SearchOption) => {
    onChange(option.value);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        className={inputClass}
        value={open ? query : (selected?.label ?? '')}
        placeholder={selected ? selected.label : placeholder}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          // Let a click on an option land before the list goes away.
          blurTimer.current = setTimeout(() => {
            setOpen(false);
            setQuery('');
          }, 150);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        // Focus stays on the input (aria-activedescendant points at the
        // highlighted option), which is the combobox pattern screen readers
        // expect; the options are plain divs so nothing else steals focus.
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded border border-white/20 bg-[var(--pyre-black)] py-1 shadow-lg"
        >
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-white/40">{emptyText}</div>
          )}
          {filtered.map((option, i) => {
            const isSelected = option.value === value;
            const isActive = i === active;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handling lives on the combobox input
              <div
                key={option.value}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  isActive ? 'bg-white/10 text-[var(--pyre-creme)]' : 'text-white/80'
                } ${isSelected ? 'font-primary-semibold' : ''}`}
              >
                <span className="block leading-tight">{option.label}</span>
                {option.hint && (
                  <span className="block font-mono text-[10px] text-white/35">{option.hint}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
