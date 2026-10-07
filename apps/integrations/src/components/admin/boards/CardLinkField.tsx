// The control for a `card_link` field: the cards the answer links, as chips
// — the card's title and the column it sits in, a link to open it when the
// viewer may open its board — and a search box that offers the cards the
// field may link (api/admin/board-link-options).
//
// The answer is the list of linked card ids (lib/boards/links.ts), and this
// control speaks it: a pick adds an id (or, on a one-card field, replaces
// the one there), Remove takes one away, and the drawer saves the list. The
// route makes and undoes the links, so a save the route refuses (a column
// the field doesn't offer, a practitioner already on another event) comes
// back as the drawer's save error.
//
// It also draws the field's own label, with a plus beside it when the viewer
// may add cards to the linked board: the plus opens a one-line quick-add
// right here, the card is made on that board (POST board-link-options), and
// it is linked like a pick — an event for a practitioner, written from the
// practitioner's card. Whether the plus shows is asked once per field per
// page (linkCreateInfoHref).

import { useEffect, useId, useRef, useState } from 'react';
import {
  type LinkSummary,
  linkCreateInfoHref,
  linkedCardHref,
  linkOptionsHref,
} from '@/lib/boards/links';
import { BOARD_LIMITS, isFinishedKind } from '@/lib/boards/types';
import { readError, sendJson } from '@/lib/client/api';
import { inputClass, labelClass } from '../goalsUi';
import { QuickAdd } from './QuickAdd';

interface CreateInfo {
  noun: string;
  boardName: string;
}

// One ask per field per page load: the drawer opens and closes often.
const createInfoCache = new Map<string, Promise<CreateInfo | null>>();

function loadCreateInfo(fieldId: string): Promise<CreateInfo | null> {
  let pending = createInfoCache.get(fieldId);
  if (!pending) {
    pending = fetch(linkCreateInfoHref(fieldId))
      .then(async (res) =>
        res.ok ? (((await res.json()) as { create?: CreateInfo | null }).create ?? null) : null
      )
      .catch(() => null);
    createInfoCache.set(fieldId, pending);
  }
  return pending;
}

export interface CardLinkFieldProps {
  id: string;
  /** The field's name: the heading, and the search box's accessible name. */
  label: string;
  hint?: string | null;
  /** A retired field: marked as such, and read-only. */
  retired?: boolean;
  /** The board_fields.id the options are asked for. */
  fieldId: string;
  /** The linked card ids, in the order they were linked. */
  value: string[];
  multiple: boolean;
  /** Summaries for ids the answer already listed, and any picked since. */
  known: Map<string, LinkSummary>;
  disabled?: boolean;
  onChange: (ids: string[] | null) => void;
  /** A card was picked: remember its summary so its chip has a title. */
  onPicked: (summary: LinkSummary) => void;
}

const chipClass =
  'inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1 pl-3 pr-1.5 text-sm text-white/85';

function ColumnBadge({ summary }: { summary: LinkSummary }) {
  const finished = isFinishedKind(summary.column_kind);
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
        finished ? 'bg-white/5 text-white/35' : 'bg-white/10 text-white/60'
      }`}
    >
      {summary.column_label}
    </span>
  );
}

export function CardLinkField({
  id,
  label,
  hint,
  retired = false,
  fieldId,
  value,
  multiple,
  known,
  disabled = false,
  onChange,
  onPicked,
}: CardLinkFieldProps) {
  const listId = useId();
  const [createInfo, setCreateInfo] = useState<CreateInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    void loadCreateInfo(fieldId).then((info) => {
      if (!cancelled) setCreateInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [fieldId, disabled]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<LinkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Ask as the person types, a beat after they stop; a stale answer to an
  // earlier query never overwrites a newer one.
  useEffect(() => {
    if (!open || disabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void fetch(linkOptionsHref(fieldId, query))
        .then(async (res) => {
          if (cancelled) return;
          if (!res.ok) {
            setError(await readError(res));
            return;
          }
          const body = (await res.json()) as { options?: LinkSummary[] };
          setError(null);
          setOptions(body.options ?? []);
        })
        .catch(() => {
          if (!cancelled) setError('Could not load cards to link.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, fieldId, disabled]);

  // Clicking anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const full = multiple && value.length >= BOARD_LIMITS.linksPerField;
  const offered = options.filter((option) => !value.includes(option.id));

  const pick = (summary: LinkSummary) => {
    onPicked(summary);
    onChange(multiple ? [...value, summary.id] : [summary.id]);
    setQuery('');
    setOpen(false);
  };

  const create = async (title: string) => {
    setAddError(null);
    try {
      const { card } = await sendJson<{ card: LinkSummary }>(
        '/api/admin/board-link-options',
        'POST',
        { field: fieldId, title }
      );
      pick(card);
      setAdding(false);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not add the card');
    }
  };

  const remove = (cardId: string) => {
    const next = value.filter((entry) => entry !== cardId);
    onChange(next.length > 0 ? next : null);
  };

  const canAdd = createInfo !== null && !disabled && !full;

  return (
    <div ref={wrapRef} className="space-y-2">
      <div className="-mb-0.5 flex items-center gap-2">
        <label className={`${labelClass} mb-0`} htmlFor={id}>
          {label}
          {retired && <span className="ml-2 text-white/30">(retired)</span>}
        </label>
        {canAdd && (
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded border border-white/15 text-xs leading-none text-white/60 hover:border-white/40 hover:text-white"
            aria-label={`Add a new ${createInfo.noun} to ${createInfo.boardName} and link it`}
            title={`New ${createInfo.noun} on ${createInfo.boardName}`}
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
              setAddError(null);
            }}
          >
            +
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-white/40">{hint}</p>}

      {adding && canAdd && (
        <div className="space-y-1">
          <QuickAdd
            noun={createInfo.noun}
            placeholder={`New ${createInfo.noun} on ${createInfo.boardName}…`}
            focusOnMount
            onAdd={create}
            onCancel={() => setAdding(false)}
          />
          {addError && <p className="text-xs text-[var(--pyre-red)]">{addError}</p>}
        </div>
      )}

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((cardId) => {
            const summary = known.get(cardId);
            const title = summary?.title ?? 'Linked card';
            return (
              <li key={cardId} className={chipClass}>
                {summary?.openable ? (
                  <a
                    href={linkedCardHref(summary)}
                    className="min-w-0 truncate underline decoration-white/20 underline-offset-2 hover:text-white"
                    title={`Open ${title} on ${summary.board_name}`}
                  >
                    {title}
                  </a>
                ) : (
                  <span className="min-w-0 truncate" title={title}>
                    {title}
                  </span>
                )}
                {summary && <ColumnBadge summary={summary} />}
                {!disabled && (
                  <button
                    type="button"
                    className="shrink-0 rounded-full px-1.5 text-white/40 hover:text-[var(--pyre-red)]"
                    aria-label={`Unlink ${title}`}
                    onClick={() => remove(cardId)}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && !full && (
        <div className="relative">
          <input
            id={id}
            className={inputClass}
            type="search"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`Find a card for ${label}`}
            placeholder={
              multiple || value.length === 0 ? 'Search to link a card…' : 'Search to change it…'
            }
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && open) {
                // Close the list, not the drawer.
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setOpen(false);
              }
              if (e.key === 'Enter' && offered[0]) {
                e.preventDefault();
                pick(offered[0]);
              }
            }}
          />
          {open && (
            <div
              id={listId}
              className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-[#161412] p-1 shadow-lg"
            >
              {error ? (
                <p className="px-2 py-1.5 text-xs text-[var(--pyre-red)]">{error}</p>
              ) : offered.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-white/40">
                  {loading ? 'Looking…' : query.trim() ? 'No cards match.' : 'No cards to link.'}
                </p>
              ) : (
                <ul>
                  {offered.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-white/80 hover:bg-white/10"
                        onClick={() => pick(option)}
                      >
                        <span className="min-w-0 truncate">{option.title}</span>
                        <ColumnBadge summary={option} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
