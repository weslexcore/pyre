// The search box in a board view's filter row (a board, All tasks): a
// magnifier inside a fixed-width text field that narrows the cards as the
// person types.

import { inputBaseClass } from '../goalsUi';

export function SearchField({
  id,
  value,
  onChange,
  placeholder = 'Search',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        Search
      </label>
      <div className="relative min-w-0">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-white/40">
          <SearchIcon />
        </span>
        {/* A plain text input, like the global search: WebKit gives
            type="search" its own chrome and does not honour the left
            padding until the field is first painted with focus, which
            left the icon sitting on top of the placeholder. */}
        <input
          id={id}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={`${inputBaseClass} h-10 w-40 min-w-0 appearance-none pl-9 sm:w-56`}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
