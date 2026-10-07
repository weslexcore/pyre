// The top of an opened card: the title, large and editable in place, and
// under it a row of quiet pickers — status, who is on it, when it is due
// (and whether it repeats), what it is waiting on. Each is a small chip that
// opens a menu, so the drawer's first screen is the card's body rather than
// a form of labelled selects.

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  describeRepeat,
  nextRepeatDate,
  REPEAT_EVERY_MAX,
  REPEAT_PRESETS,
  REPEAT_UNITS,
  type RepeatRule,
  type RepeatUnit,
} from '@/lib/boards/recurrence';
import { BOARD_LIMITS } from '@/lib/boards/types';
import { formatYmd } from '@/lib/boards/validate';
import { useDismiss } from '@/lib/client/useDismiss';
import type { BoardColumnRow } from '@/lib/db';
import { AvatarStack, ColumnDot, inputBaseClass, inputClass, RepeatIcon } from '../goalsUi';

/** The chip every picker opens from: quiet until hovered. */
const chipClass =
  'inline-flex min-h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-white/70 transition-colors hover:border-white/25 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--pyre-gold)] disabled:opacity-50';

const menuItemClass =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs text-white/80 hover:bg-white/5';

/** Breathing room kept between a menu and the edge of the viewport. */
const EDGE_MARGIN = 8;

/**
 * A chip and the menu it opens. Escape and a press outside close the menu
 * without closing the drawer around it.
 */
function Picker({
  label,
  trigger,
  children,
  disabled = false,
  panelClassName = 'w-64',
}: {
  /** What the chip is, for a screen reader: "Status: In progress". */
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  // Keep the menu on screen when its chip sits near the right edge.
  const positionPanel = useCallback((panel: HTMLDivElement | null) => {
    if (!panel || !rootRef.current) return;
    panel.style.transform = '';
    const viewport = document.documentElement.clientWidth;
    const left = rootRef.current.getBoundingClientRect().left;
    const rightmost = Math.max(EDGE_MARGIN, viewport - EDGE_MARGIN - panel.offsetWidth);
    const offset = Math.min(Math.max(left, EDGE_MARGIN), rightmost) - left;
    if (offset !== 0) panel.style.transform = `translateX(${offset}px)`;
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    // The drawer closes on Escape too; this one is the menu's.
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: catches Escape from inside the menu
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={chipClass}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen((on) => !on)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          ref={positionPanel}
          role="dialog"
          aria-label={label}
          className={`absolute left-0 top-full z-30 mt-1 max-h-[60vh] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-white/15 bg-[var(--pyre-black)] p-2 shadow-xl ${panelClassName}`}
        >
          {children(() => {
            setOpen(false);
            buttonRef.current?.focus();
          })}
        </div>
      )}
    </div>
  );
}

/** The card's title: a heading until pressed, then a field that grows with it. */
export function InlineTitle({
  id,
  value,
  finished,
  onChange,
}: {
  /** The heading's id, which names the drawer. */
  id: string;
  value: string;
  finished: boolean;
  /** Every keystroke; '' is never committed (the title snaps back instead). */
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const before = useRef(value);

  const fitHeight = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    fitHeight();
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing, fitHeight]);

  const start = () => {
    before.current = value;
    setEditing(true);
  };
  const finish = () => {
    // A card always has a title: leaving it empty puts the last one back.
    if (!value.trim()) onChange(before.current);
    setEditing(false);
  };

  const tone = finished ? 'text-white/40 line-through' : 'text-[var(--pyre-creme)]';
  const type = 'text-xl font-semibold leading-snug sm:text-2xl';

  if (editing) {
    return (
      <>
        <span id={id} className="sr-only">
          {value || before.current}
        </span>
        <textarea
          ref={fieldRef}
          aria-label="Title"
          rows={1}
          maxLength={BOARD_LIMITS.title}
          className={`-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md border border-white/20 bg-white/[0.04] px-2 py-1 outline-none focus:border-[var(--pyre-gold)]/60 ${type} ${tone}`}
          value={value}
          onChange={(e) => {
            // A title is one line; a pasted newline becomes a space.
            onChange(e.target.value.replace(/\s*\n\s*/g, ' '));
            fitHeight();
          }}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              onChange(before.current);
              setEditing(false);
            }
          }}
        />
      </>
    );
  }

  return (
    <h2 className="min-w-0">
      <button
        type="button"
        title="Edit the title"
        className={`-mx-2 block w-[calc(100%+1rem)] rounded-md border border-transparent px-2 py-1 text-left break-words hover:border-white/15 hover:bg-white/[0.03] ${type} ${tone}`}
        onClick={start}
      >
        <span id={id}>{value}</span>
        <span className="sr-only">, edit the title</span>
      </button>
    </h2>
  );
}

export function StatusPicker({
  columns,
  value,
  onChange,
}: {
  columns: BoardColumnRow[];
  value: string;
  onChange: (columnId: string) => void;
}) {
  const current = columns.find((column) => column.id === value);
  return (
    <Picker
      label={`Status: ${current?.label ?? 'none'}`}
      panelClassName="w-56"
      trigger={
        <>
          {current && <ColumnDot column={current} />}
          <span className="max-w-[10rem] truncate">{current?.label ?? 'Status'}</span>
          <Caret />
        </>
      }
    >
      {(close) => (
        <ul className="space-y-0.5">
          {columns.map((column) => (
            <li key={column.id}>
              <button
                type="button"
                aria-pressed={column.id === value}
                className={menuItemClass}
                onClick={() => {
                  onChange(column.id);
                  close();
                }}
              >
                <ColumnDot column={column} />
                <span className="flex-1">{column.label}</span>
                {column.id === value && <Check />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Picker>
  );
}

export function AssigneePicker({
  owners,
  value,
  names,
  onChange,
  clears,
  onClearsChange,
}: {
  owners: { email: string; name: string }[];
  value: string[];
  names: (email: string) => string;
  onChange: (next: string[]) => void;
  /**
   * For a column, not a card: an empty list there means "leave the card's
   * assignees alone", so unassigning is a choice of its own — "No one".
   * Given, the picker offers it; picking a person turns it off (the parent's
   * onChange does that).
   */
  clears?: boolean;
  onClearsChange?: (on: boolean) => void;
}) {
  const forColumn = onClearsChange !== undefined;
  // The roster's name for someone just picked, before any response names them.
  const nameOf = (email: string) =>
    owners.find((owner) => owner.email === email)?.name ?? names(email);
  // Someone already on the card stays pickable even if the roster no longer lists them.
  const options = [
    ...owners,
    ...value
      .filter((email) => !owners.some((owner) => owner.email === email))
      .map((email) => ({ email, name: names(email) })),
  ];
  const toggle = (email: string) =>
    onChange(value.includes(email) ? value.filter((e) => e !== email) : [...value, email]);

  return (
    <Picker
      label={
        value.length > 0
          ? `Assignees: ${value.map(nameOf).join(', ')}`
          : forColumn
            ? clears
              ? 'Assignees: unassigns the card'
              : 'Assignees: left as they are'
            : 'Assignees: nobody'
      }
      trigger={
        forColumn && clears ? (
          <>
            <span
              aria-hidden="true"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-white/30 text-[11px] text-white/50"
            >
              –
            </span>
            <span className="text-white/70">No one</span>
          </>
        ) : value.length > 0 ? (
          <>
            <AvatarStack emails={value} names={nameOf} />
            {value.length === 1 && (
              <span className="max-w-[8rem] truncate">{nameOf(value[0])}</span>
            )}
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-white/30 text-[11px] text-white/50"
            >
              +
            </span>
            <span className="text-white/45">Assign</span>
          </>
        )
      }
    >
      {() => (
        <div>
          {forColumn && (
            <label className={`${menuItemClass} mb-0.5 cursor-pointer`}>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--pyre-red)]"
                checked={clears === true}
                onChange={(e) => onClearsChange(e.target.checked)}
              />
              <span className="flex-1 truncate">No one (unassigns the card)</span>
            </label>
          )}
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-white/40">Nobody to assign yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {options.map((owner) => (
                <li key={owner.email}>
                  <label className={`${menuItemClass} cursor-pointer`}>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--pyre-red)]"
                      checked={value.includes(owner.email)}
                      onChange={() => toggle(owner.email)}
                    />
                    <AvatarStack emails={[owner.email]} names={() => owner.name} />
                    <span className="flex-1 truncate">{owner.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {(value.length > 0 || (forColumn && clears)) && (
            <button
              type="button"
              className="mt-1 w-full rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-white"
              onClick={() => (forColumn ? onClearsChange(false) : onChange([]))}
            >
              {forColumn ? 'Leave assignees as they are' : 'Unassign everyone'}
            </button>
          )}
        </div>
      )}
    </Picker>
  );
}

/** Which repeat choice a rule is: a preset's index, 'custom', or 'never'. */
function repeatChoiceOf(rule: RepeatRule | null): string {
  if (!rule) return 'never';
  const index = REPEAT_PRESETS.findIndex(
    (preset) => preset.rule.every === rule.every && preset.rule.unit === rule.unit
  );
  return index >= 0 ? String(index) : 'custom';
}

export function DuePicker({
  value,
  repeat,
  today,
  onDateChange,
  onRepeatChange,
}: {
  value: string;
  repeat: RepeatRule | null;
  today: string;
  onDateChange: (next: string) => void;
  /** `delay` is how long to wait before saving — typing a number waits. */
  onRepeatChange: (next: RepeatRule | null, delay: number) => void;
}) {
  const dateId = useId();
  const repeatId = useId();
  const [custom, setCustom] = useState(() => repeatChoiceOf(repeat) === 'custom');
  const choice = custom ? 'custom' : repeatChoiceOf(repeat);
  const overdue = value !== '' && value < today;
  const tone = !value
    ? 'text-white/45'
    : overdue
      ? 'text-[var(--pyre-red)]'
      : value === today
        ? 'text-[var(--pyre-gold)]'
        : '';

  const label = value
    ? `Due ${formatYmd(value)}${repeat ? `, repeats ${describeRepeat(repeat).toLowerCase()}` : ''}`
    : repeat
      ? `Repeats ${describeRepeat(repeat).toLowerCase()}, no date`
      : 'Due date: none';

  const setRule = (rule: RepeatRule | null, delay = 0) => {
    // A repeat counts from a date; a card that had none starts today.
    if (rule && !value) onDateChange(today);
    onRepeatChange(rule, delay);
  };

  return (
    <Picker
      label={label}
      panelClassName="w-72"
      trigger={
        <span className={`inline-flex items-center gap-1.5 ${tone}`}>
          {repeat ? <RepeatIcon className="h-3 w-3" /> : <CalendarIcon />}
          <span>{value ? formatYmd(value) : 'Due date'}</span>
        </span>
      }
    >
      {() => (
        <div className="space-y-3 p-1">
          <div>
            <label
              className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-white/45"
              htmlFor={dateId}
            >
              {repeat ? 'Next due' : 'Due'}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={dateId}
                className={`${inputBaseClass} min-w-0 flex-1`}
                type="date"
                value={value}
                onChange={(e) => {
                  // A repeating card needs a date to count from; clearing it stops the repeat.
                  if (!e.target.value && repeat) onRepeatChange(null, 0);
                  onDateChange(e.target.value);
                }}
              />
              {value && (
                <button
                  type="button"
                  className="rounded border border-white/10 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-white"
                  onClick={() => {
                    if (repeat) onRepeatChange(null, 0);
                    setCustom(false);
                    onDateChange('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <label
              className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-white/45"
              htmlFor={repeatId}
            >
              Repeat
            </label>
            <select
              id={repeatId}
              className={`${inputClass}`}
              value={choice}
              onChange={(e) => {
                const next = e.target.value;
                if (next === 'never') {
                  setCustom(false);
                  setRule(null);
                } else if (next === 'custom') {
                  setCustom(true);
                  setRule(repeat ?? { every: 2, unit: 'week' });
                } else {
                  setCustom(false);
                  setRule(REPEAT_PRESETS[Number(next)].rule);
                }
              }}
            >
              <option value="never">Does not repeat</option>
              {REPEAT_PRESETS.map((preset, index) => (
                <option key={preset.label} value={String(index)}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {custom && repeat && (
              <div className="mt-2 flex items-center gap-2 font-mono text-xs text-white/60">
                <span>Every</span>
                <input
                  aria-label="Repeat every"
                  className={`${inputBaseClass} w-16`}
                  type="number"
                  min={1}
                  max={REPEAT_EVERY_MAX}
                  value={repeat.every}
                  onChange={(e) => {
                    const every = Math.round(Number(e.target.value));
                    if (!Number.isFinite(every) || every < 1 || every > REPEAT_EVERY_MAX) return;
                    setRule({ ...repeat, every }, 600);
                  }}
                />
                <select
                  aria-label="Repeat unit"
                  className={`${inputBaseClass} min-w-0 flex-1`}
                  value={repeat.unit}
                  onChange={(e) => setRule({ ...repeat, unit: e.target.value as RepeatUnit })}
                >
                  {REPEAT_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {repeat.every === 1 ? unit : `${unit}s`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {repeat && (
              <p className="mt-2 text-xs text-white/40">
                When this one is finished, the next is filed due{' '}
                {formatYmd(nextRepeatDate(value || today, repeat, today))}.
              </p>
            )}
          </div>
        </div>
      )}
    </Picker>
  );
}

export function WaitingPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  /** A finished card waits on nobody. */
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const inputId = useId();
  return (
    <Picker
      label={value ? `Waiting on: ${value}` : 'Waiting on: nothing'}
      disabled={disabled && !value}
      panelClassName="w-72"
      trigger={
        value ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--pyre-gold)]">
            <PauseIcon />
            <span className="max-w-[10rem] truncate">{value}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-white/45">
            <PauseIcon />
            Waiting on
          </span>
        )
      }
    >
      {(close) => (
        <div className="space-y-2 p-1">
          <label
            className="block font-mono text-[10px] uppercase tracking-wide text-white/45"
            htmlFor={inputId}
          >
            Waiting on
          </label>
          <input
            id={inputId}
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.waitingOn}
            placeholder="Sarah's availability, the insurer, a quote…"
            value={value}
            // biome-ignore lint/a11y/noAutofocus: the menu opened to type this
            autoFocus
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') close();
            }}
          />
          <p className="text-xs text-white/35">
            The card stays where it is; the badge says why it is stuck.
          </p>
          {value && (
            <button
              type="button"
              className="w-full rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-white"
              onClick={() => {
                onChange('');
                close();
              }}
            >
              Not waiting any more
            </button>
          )}
        </div>
      )}
    </Picker>
  );
}

function Caret() {
  return (
    <span aria-hidden="true" className="text-[9px] text-white/35">
      ▾
    </span>
  );
}

function Check() {
  return (
    <span aria-hidden="true" className="text-[var(--pyre-gold)]">
      ✓
    </span>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="h-3 w-3"
    >
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className="h-3 w-3"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.5 5.5v5M9.5 5.5v5" />
    </svg>
  );
}
