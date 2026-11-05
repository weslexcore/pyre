// SOP library for /admin/sops: documents grouped by section (the free-text
// `category` on each document), filtered server-side to what the caller's role
// may view and sorted by the admin-managed section order. Admins get a create
// form (title, section, access levels, and optional rough notes the writing
// assistant drafts the document from once its editor opens), can add/rename/remove the sections
// themselves — including empty ones, which the server keeps in the list so a
// new section is somewhere to file the next SOP rather than a no-op — see
// archived documents, and reorder by drag and drop: the
// ⠿ handle on a card moves a document within its section or into another
// section, the handle on a section header reorders sections. The arrangement
// updates live while dragging (native HTML5 drag events, no library) and
// persists on drop via /api/admin/sop-order; releasing outside a drop target
// (or pressing Escape) restores the previous order. The API enforces the real
// guards — this island just mirrors them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmAction } from '@/components/admin/ConfirmDialog';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { assistNotesKey } from '@/components/admin/SopAssist';
import {
  buttonClass,
  dragHandleClass,
  goldButtonClass,
  inputClass,
  selectClass,
} from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { etStamp } from '@/lib/client/format';
import { optimistic } from '@/lib/client/optimistic';
import { useLiveReorder } from '@/lib/client/useLiveReorder';
import type { SopRow } from '@/lib/db';
import { EVERYONE_LABEL, ROLE_LABELS, type SopRole, slugify } from '@/lib/sops/levels';
import {
  actorLabel,
  ownRunsFirst,
  type PeopleNames,
  personName,
  sameActor,
} from '@/lib/sops/names';
import {
  categoriesInOrder,
  moveSopToCategoryEnd,
  repositionCategory,
  repositionSop,
} from '@/lib/sops/order';
import { sopPrintHref } from '@/lib/sops/print';
import type { ActiveRun } from '@/lib/sops/runs';
import { highlightSegments, MIN_QUERY_LENGTH } from '@/lib/sops/search';
import type { ShiftSops } from '@/lib/sops/shift-sops';
import { ShiftSopsPanel } from './ShiftSops';
import {
  type GrantablePerson,
  SopAccessPicker,
  type SopGrant,
  withAdmins,
} from './SopAccessPicker';

type SopSummary = Omit<SopRow, 'content_md'> & {
  task_count: number;
  /** Who can read it, in words — computed server-side (see /api/admin/sops). */
  access_label: string;
};

interface ListResponse {
  sops: SopSummary[];
  /** Section names in display order, empty sections included (admins only). */
  categories?: string[];
  /** Roster an admin can grant access to on the create form; admins only. */
  staff?: GrantablePerson[];
  /** Roster names for the `updated_by` emails on the cards. */
  people?: PeopleNames;
  role: SopRole;
  /** The create form offers rough notes for the writing assistant (admins only). */
  assistEnabled?: boolean;
  pins: string[];
  /** The caller's own current-or-next shift duties; null when they hold none. */
  shiftSops: ShiftSops | null;
}

type Drag = { kind: 'sop'; id: string } | { kind: 'category'; name: string };

/** The order as of drag start, restored when the drag is cancelled. */
type DragSnapshot = { sops: SopSummary[]; categories: string[] };

interface SearchResult {
  id: string;
  slug: string;
  title: string;
  category: string;
  archived: boolean;
  titleMatch: boolean;
  matchCount: number;
  snippets: string[];
}

/** `newCategory` value standing for "a section that doesn't exist yet". */
const NEW_SECTION = '\u0000new';

/** Text with every occurrence of `term` wrapped in <mark>. */
function Marked({ text, term }: { text: string; term: string }) {
  let offset = 0;
  return (
    <>
      {highlightSegments(text, term).map((segment) => {
        const key = offset;
        offset += segment.text.length;
        return segment.match ? (
          <mark
            key={key}
            className="rounded-sm bg-[var(--pyre-gold)] px-0.5 text-[var(--pyre-black)]"
          >
            {segment.text}
          </mark>
        ) : (
          segment.text
        );
      })}
    </>
  );
}

/**
 * Who may read this SOP, counting the editors who implicitly may. A document
 * everyone can read is the default and not worth a badge; anything narrower is
 * worth seeing without opening the document. The phrasing comes from the
 * server, which is the only side that sees the individual grants.
 */
function AccessBadge({ label }: { label: string }) {
  if (label === EVERYONE_LABEL) return null;
  // Admins-only is the tightest state and reads as a warning; everything else
  // is merely narrowed.
  const color = label === ROLE_LABELS.admin ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-gold)]';
  return (
    <span className={`font-mono text-[10px] uppercase tracking-wide ${color}`}>
      view: {label.toLowerCase()}
    </span>
  );
}

/** The library's reads; lib/client/pageData warms both when a link here is hovered. */
const LIBRARY_URL = '/api/admin/sops';
const ACTIVE_RUNS_URL = '/api/admin/sop-runs?view=active';

interface ActiveRunsResponse {
  runs?: ActiveRun[];
  people?: PeopleNames;
  viewer?: string;
}

export function SopsIndex() {
  // The library is cached across navigations: opening a document and coming
  // back paints the list at once and revalidates behind it. Every change
  // below writes to this entry first and lets the server catch up.
  const library = useCachedJson<ListResponse>(LIBRARY_URL);
  const { data, setData } = library;
  const sops = useMemo(() => data?.sops ?? [], [data]);
  // Server-supplied so sections holding nothing yet still get a header;
  // deriving from the documents would drop them.
  const categories = useMemo(() => data?.categories ?? categoriesInOrder(data?.sops ?? []), [data]);
  const role: SopRole = data?.role ?? 'staff';
  const assistEnabled = data?.assistEnabled ?? false;
  const staff = data?.staff ?? [];
  // The caller's pinned document ids (personal; shown in the Pinned strip).
  const pins = useMemo(() => new Set(data?.pins ?? []), [data]);
  // The duty documents for the caller's own current-or-next shift, shown
  // above everything else: what you are about to do beats what is merely
  // filed on this page.
  const shiftSops = data?.shiftSops ?? null;
  const loading = library.loading;
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? library.error;
  const setError = setActionError;

  // Live edits to the arrangement (drag and drop, section changes) go into
  // the cached list, which is what the cards render from.
  const setSops = useCallback(
    (update: (prev: SopSummary[]) => SopSummary[]) =>
      setData((prev) => (prev ? { ...prev, sops: update(prev.sops) } : prev)),
    [setData]
  );
  const setCategories = useCallback(
    (update: (prev: string[]) => string[]) =>
      setData((prev) =>
        prev
          ? { ...prev, categories: update(prev.categories ?? categoriesInOrder(prev.sops)) }
          : prev
      ),
    [setData]
  );

  const [showCreate, setShowCreate] = useState(false);
  // Slugs ticked for printing; null when the library isn't in print-select
  // mode. In that mode a card tap ticks it instead of opening it.
  const [printSelection, setPrintSelection] = useState<Set<string> | null>(null);
  // Only the create form waits on the server (it navigates into the new
  // document on success); everything else on the page changes at once.
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  // Either an existing section name or NEW_SECTION, in which case the typed
  // `newCategoryName` is the section to create alongside the document.
  const [newCategory, setNewCategory] = useState<string>(NEW_SECTION);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  // New documents start readable by everyone and editable by admins — the
  // same defaults the columns carry.
  const [newView, setNewView] = useState<SopGrant>({
    roles: ['staff', 'shift_lead', 'admin'],
    emails: [],
  });
  const [newEdit, setNewEdit] = useState<SopGrant>({ roles: ['admin'], emails: [] });

  // Standalone "add a section" form, and the header being renamed in place.
  const [showAddSection, setShowAddSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Escape has to reach the blur that follows it, and state wouldn't have
  // re-rendered by then — the rename commits on blur alone, so this is how the
  // cancel gets there.
  const renameCancelledRef = useRef(false);

  // Debounced library search; snippets come from the server so results only
  // ever cover documents this user may view. Each query is its own cache
  // entry, so retyping a term you already searched answers at once.
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setDebouncedQuery('');
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(q), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const search = useCachedJson<{ results: SearchResult[] }>(
    debouncedQuery ? `/api/admin/sops?q=${encodeURIComponent(debouncedQuery)}` : null
  );
  const queryPending = query.trim().length >= MIN_QUERY_LENGTH && debouncedQuery !== query.trim();
  const searching = queryPending || search.loading;
  const results: SearchResult[] | null =
    debouncedQuery && !queryPending ? (search.data?.results ?? null) : null;
  useEffect(() => {
    if (search.error) setActionError(search.error);
  }, [search.error]);

  // Resume strip. Separate from the library read so a runs outage still
  // leaves a working SOP list: unfinished runs on documents this role may
  // view — runs are shared per document, so someone else's open checklist is
  // the one you walk up to and continue.
  const runsQuery = useCachedJson<ActiveRunsResponse>(ACTIVE_RUNS_URL);
  const activeRuns = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data]);
  // The session email, from the runs response, so the strip can put the
  // viewer's own open checklists first and label them as theirs.
  const viewerEmail = runsQuery.data?.viewer ?? '';
  // Whoever started an open run may not be an editor of any document, so
  // the strip brings its own names.
  const people = useMemo(
    () => ({ ...(runsQuery.data?.people ?? {}), ...(data?.people ?? {}) }),
    [runsQuery.data, data]
  );

  // Own open checklists first — they are the ones this person has to finish —
  // then everyone else's, each group newest first as the API returns them.
  const orderedActiveRuns = useMemo(
    () => ownRunsFirst(activeRuns, viewerEmail),
    [activeRuns, viewerEmail]
  );
  // The open run per document, so each card can say it is in progress (and
  // whose it is) without a trip to the strip.
  const activeBySop = useMemo(() => {
    const map = new Map<string, ActiveRun>();
    // Newest first, so the first run seen per document is the open one.
    for (const run of activeRuns) if (!map.has(run.sop_id)) map.set(run.sop_id, run);
    return map;
  }, [activeRuns]);

  // Optimistic flip; the response's authoritative list replaces it, and a
  // refusal puts it back.
  const togglePin = (sop: SopSummary) => {
    const pinned = !pins.has(sop.id);
    setError(null);
    return optimistic(
      setData,
      (prev) =>
        prev
          ? {
              ...prev,
              pins: pinned ? [...prev.pins, sop.id] : prev.pins.filter((id) => id !== sop.id),
            }
          : prev,
      () => sendJson<{ pins: string[] }>('/api/admin/sop-pins', 'PUT', { sopId: sop.id, pinned }),
      {
        reconcile: (current, body) => (current ? { ...current, pins: body.pins } : current),
        onError: setError,
      }
    );
  };

  // The section the create form will file the document under: the chosen one,
  // or the name typed into the "new section" field.
  const chosenCategory = (newCategory === NEW_SECTION ? newCategoryName : newCategory).trim();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { sop } = await sendJson<{ sop: SopRow }>('/api/admin/sops', 'POST', {
        title: newTitle.trim(),
        // The API gives a brand-new section a position of its own, so a
        // section named here behaves exactly like one added on its own.
        category: chosenCategory || 'General',
        viewRoles: withAdmins(newView.roles),
        viewEmails: newView.emails,
        editRoles: withAdmins(newEdit.roles),
        editEmails: newEdit.emails,
        content: `# ${newTitle.trim()}\n`,
      });
      // The editor's writing assistant picks these up and drafts from them.
      // Best-effort: without storage, the editor opens with an empty
      // assistant and the notes can be pasted there.
      if (assistEnabled && newNotes.trim()) {
        try {
          window.sessionStorage.setItem(assistNotesKey(sop.slug), newNotes);
        } catch {
          // Storage blocked; nothing to hand off.
        }
      }
      // The list this page comes back to has a new card on it.
      invalidateJson(LIBRARY_URL);
      // Straight into the editor for the new document.
      window.location.href = `/admin/sops/${sop.slug}?edit=1`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create SOP');
      setBusy(false);
    }
  };

  // ---- sections ------------------------------------------------------------

  // New sections land last and hold nothing: the header goes on at once and
  // the form pre-selects it, so "add a section" flows straight into filling it.
  const addSection = () => {
    const name = sectionDraft.trim();
    if (!name) return;
    setError(null);
    setSectionDraft('');
    setShowAddSection(false);
    setNewCategory(name);
    return optimistic(
      setData,
      (prev) =>
        prev
          ? {
              ...prev,
              categories: [...(prev.categories ?? categoriesInOrder(prev.sops)), name],
            }
          : prev,
      () => sendJson('/api/admin/sop-categories', 'POST', { name }),
      {
        onError: (message) => {
          setError(message);
          setNewCategory(NEW_SECTION);
        },
      }
    );
  };

  // Every document in the section moves with it, so the rename is applied
  // to the header and the cards together.
  const renameSection = (name: string) => {
    const newName = renameDraft.trim();
    setRenaming(null);
    if (!newName || newName === name) return;
    setError(null);
    return optimistic(
      setData,
      (prev) =>
        prev
          ? {
              ...prev,
              categories: (prev.categories ?? categoriesInOrder(prev.sops)).map((c) =>
                c === name ? newName : c
              ),
              sops: prev.sops.map((s) => (s.category === name ? { ...s, category: newName } : s)),
            }
          : prev,
      () => sendJson('/api/admin/sop-categories', 'PATCH', { name, newName }),
      { onError: setError }
    );
  };

  const deleteSection = async (name: string) => {
    if (
      !(await confirmAction({
        title: `Remove the "${name}" section?`,
        body: 'It has no SOPs in it.',
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    setError(null);
    await optimistic(
      setData,
      (prev) =>
        prev
          ? {
              ...prev,
              categories: (prev.categories ?? categoriesInOrder(prev.sops)).filter(
                (c) => c !== name
              ),
            }
          : prev,
      () => sendJson(`/api/admin/sop-categories?name=${encodeURIComponent(name)}`, 'DELETE'),
      { onError: setError }
    );
  };

  // ---- drag and drop -------------------------------------------------------

  const reorder = useLiveReorder<Drag, DragSnapshot>({
    onDrop: (finished, before) => void commit(finished, before),
    // Cancelled (Escape, or released outside) — put everything back.
    onCancel: (before) => {
      setSops(() => before.sops);
      setCategories(() => before.categories);
    },
  });
  const drag = reorder.drag;

  const beginDrag = (e: React.DragEvent, next: Drag, cardSelector?: string) =>
    reorder.begin(
      e,
      next,
      { sops, categories },
      next.kind === 'sop' ? next.id : next.name,
      cardSelector
    );

  const startSopDrag = (e: React.DragEvent, sop: SopSummary) =>
    beginDrag(e, { kind: 'sop', id: sop.id }, '[data-sop-card]');

  const enterSop = (targetId: string) => {
    if (drag?.kind !== 'sop' || drag.id === targetId) return;
    if (!reorder.enterOnce(`sop:${targetId}`)) return;
    setSops((prev) => repositionSop(prev, drag.id, targetId));
  };

  const enterCategory = (name: string) => {
    if (!drag) return;
    if (drag.kind === 'category') {
      if (drag.name === name || !reorder.enterOnce(`cat:${name}`)) return;
      setCategories((prev) => repositionCategory(prev, drag.name, name));
    } else {
      // A document dragged onto a section header (or empty section) goes to
      // that section's end.
      if (!reorder.enterOnce(`end:${name}`)) return;
      setSops((prev) => moveSopToCategoryEnd(prev, drag.id, name));
    }
  };

  // The live-drag arrangement on screen is already the order to store, so
  // nothing waits: the requests go out and only a refusal is reported — with
  // a resync (which keeps the list on screen) to what the server holds.
  const commit = async (finished: Drag, before: DragSnapshot | null) => {
    setError(null);
    try {
      if (finished.kind === 'category') {
        await sendJson('/api/admin/sop-order', 'PUT', { categories });
      } else {
        const moved = sops.find((s) => s.id === finished.id);
        if (!moved) return;
        // A cross-section drop changes the document's category first (the
        // settings PATCH), then the order within the new section.
        const original = before?.sops.find((s) => s.id === finished.id);
        if (original && original.category !== moved.category) {
          await sendJson('/api/admin/sops', 'PATCH', { id: moved.id, category: moved.category });
        }
        await sendJson('/api/admin/sop-order', 'PUT', {
          category: moved.category,
          sopIds: sops.filter((s) => s.category === moved.category).map((s) => s.id),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the new order');
      void library.reload();
    }
  };

  const endDrag = reorder.end;

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  const isAdmin = role === 'admin';
  const searchActive = query.trim().length >= MIN_QUERY_LENGTH;
  const term = query.trim();
  const pinnedSops = sops.filter((s) => pins.has(s.id));
  const selecting = printSelection !== null;

  const togglePrint = (slugs: string[], on: boolean) =>
    setPrintSelection((prev) => {
      const next = new Set(prev);
      for (const slug of slugs) {
        if (on) next.add(slug);
        else next.delete(slug);
      }
      return next;
    });

  // Prints in library order (sections, then the order within each), however
  // the documents were ticked.
  const printSelected = () => {
    if (!printSelection || printSelection.size === 0) return;
    const ordered = categories
      .flatMap((category) => sops.filter((s) => s.category === category))
      .map((s) => s.slug)
      .filter((slug) => printSelection.has(slug));
    window.open(sopPrintHref(ordered), '_blank', 'noopener');
  };

  // One card, used by both the category grid (draggable) and the Pinned strip
  // (plain). The star pins/unpins; a gold checklist badge marks runnable SOPs.
  const renderCard = (sop: SopSummary, draggable: boolean) => {
    const isDragged = draggable && drag?.kind === 'sop' && drag.id === sop.id;
    const isPinned = pins.has(sop.id);
    const activeRun = activeBySop.get(sop.id) ?? null;
    const activeIsMine = activeRun !== null && sameActor(activeRun.started_by, viewerEmail);
    const ticked = printSelection?.has(sop.slug) ?? false;
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: passive drop target for the drag handles
      <div
        key={sop.id}
        data-sop-card
        onDragEnter={draggable ? () => enterSop(sop.id) : undefined}
        className={`relative rounded border bg-white/5 transition-colors ${
          isDragged
            ? 'border-dashed border-white/40 opacity-40'
            : ticked
              ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/10'
              : activeIsMine
                ? 'border-[var(--pyre-gold)] hover:border-[var(--pyre-gold)]'
                : activeRun
                  ? 'border-[var(--pyre-gold)]/40 hover:border-[var(--pyre-gold)]'
                  : 'border-white/10 hover:border-white/30'
        } ${sop.archived ? 'opacity-50' : ''}`}
      >
        <a
          href={`/admin/sops/${sop.slug}`}
          className="block p-4"
          draggable={false}
          tabIndex={selecting ? -1 : undefined}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex items-start gap-2 font-semibold text-[var(--pyre-creme)]">
              {selecting && (
                <span
                  aria-hidden="true"
                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] ${
                    ticked
                      ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)] text-[var(--pyre-black)]'
                      : 'border-white/40'
                  }`}
                >
                  {ticked ? '✓' : ''}
                </span>
              )}
              {sop.title}
            </h3>
            <span className="flex items-center gap-2 pr-0.5">
              {sop.archived && (
                <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                  archived
                </span>
              )}
              {/* Spacer so the title never sits under the corner buttons. */}
              <span className={draggable && isAdmin ? 'w-13' : 'w-6'} />
            </span>
          </div>
          <p className="mt-2 font-mono text-[10px] text-white/40">
            v{sop.current_version} · updated {new Date(sop.updated_at).toLocaleDateString()}
            {sop.updated_by && sop.updated_by !== 'seed'
              ? ` by ${personName(sop.updated_by, people)}`
              : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-3">
            {activeRun ? (
              <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                ☑ in progress · {activeRun.checked_count}/{activeRun.task_count} · started by{' '}
                {actorLabel(activeRun.started_by, viewerEmail, people)}
              </span>
            ) : (
              sop.task_count > 0 && (
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                  ☑ checklist · {sop.task_count} tasks
                </span>
              )
            )}
            {activeIsMine && (
              <span className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-sage)]">
                yours
              </span>
            )}
            <AccessBadge label={sop.access_label} />
          </div>
        </a>
        {/* Select mode lays a toggle over the whole card, so a tap ticks the
            document for printing instead of opening it. */}
        {selecting && (
          <button
            type="button"
            aria-pressed={ticked}
            aria-label={`Print ${sop.title}`}
            className="absolute inset-0 z-10 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-[var(--pyre-gold)]"
            onClick={() => togglePrint([sop.slug], !ticked)}
          />
        )}
        <span className="absolute top-3 right-3 flex gap-1">
          <button
            type="button"
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
              isPinned
                ? 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)]'
                : 'border-white/10 bg-white/5 text-white/40 hover:border-white/30 hover:text-white'
            }`}
            title={isPinned ? 'Unpin' : 'Pin to top'}
            aria-label={isPinned ? `Unpin ${sop.title}` : `Pin ${sop.title} to top`}
            onClick={() => void togglePin(sop)}
          >
            {isPinned ? '★' : '☆'}
          </button>
          {draggable && isAdmin && !selecting && (
            <button
              type="button"
              className={dragHandleClass}
              title="Drag to reorder (drop on another section to move it there)"
              aria-label={`Drag to reorder ${sop.title}`}
              draggable={!busy}
              onDragStart={(e) => startSopDrag(e, sop)}
              onDragEnd={endDrag}
            >
              ⠿
            </button>
          )}
        </span>
      </div>
    );
  };

  const printButton = !selecting && (
    <button
      type="button"
      className={buttonClass}
      title="Pick several SOPs and print them together"
      onClick={() => setPrintSelection(new Set())}
    >
      Print…
    </button>
  );

  return (
    <div
      className="space-y-8"
      // The whole library is one drop surface: dragover/drop bubble up here,
      // so releasing anywhere inside commits the live arrangement.
      {...reorder.surface}
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <input
        type="search"
        className={`${inputClass} w-full sm:max-w-md`}
        placeholder="Search SOPs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search SOPs"
      />

      {/* Shift SOPs, then the resume strip: the duties you are on the hook for
          this shift, then any checklist already open. Both step aside for a
          search — a query is a deliberate ask for something else. */}
      {!searchActive && shiftSops && <ShiftSopsPanel shift={shiftSops} />}

      {!searchActive && activeRuns.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
            ☑ In progress
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {orderedActiveRuns.map((run) => {
              const pct =
                run.task_count > 0 ? Math.round((run.checked_count / run.task_count) * 100) : 0;
              const mine = sameActor(run.started_by, viewerEmail);
              return (
                <a
                  key={run.id}
                  href={`/admin/sops/${run.slug}`}
                  className={`block rounded border bg-[var(--pyre-gold)]/5 p-4 transition-colors hover:border-[var(--pyre-gold)] ${
                    mine ? 'border-[var(--pyre-gold)]' : 'border-[var(--pyre-gold)]/40'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="flex flex-wrap items-baseline gap-x-2 font-semibold text-[var(--pyre-creme)]">
                      {run.title}
                      {mine && (
                        <span className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-sage)]">
                          yours
                        </span>
                      )}
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                      resume →
                    </span>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-white/10">
                    <div
                      className="h-1 rounded-full bg-[var(--pyre-gold)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-white/40">
                    {run.checked_count}/{run.task_count} done · started by{' '}
                    {actorLabel(run.started_by, viewerEmail, people)} · {etStamp(run.started_at)}
                  </p>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {searchActive && (
        <div className="space-y-3">
          {searching && results === null ? (
            <p className="font-mono text-xs text-white/40">Searching…</p>
          ) : results !== null && results.length === 0 ? (
            <p className="text-sm text-white/60">No matches for “{term}”.</p>
          ) : (
            results?.map((result) => (
              <a
                key={result.id}
                href={`/admin/sops/${result.slug}?q=${encodeURIComponent(term)}`}
                className={`block rounded border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/30 ${result.archived ? 'opacity-50' : ''}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-semibold text-[var(--pyre-creme)]">
                    <Marked text={result.title} term={term} />
                  </h3>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                    {result.category}
                    {result.archived ? ' · archived' : ''}
                  </span>
                  <span className="font-mono text-[10px] text-white/40">
                    {result.matchCount} match{result.matchCount === 1 ? '' : 'es'}
                  </span>
                </div>
                {result.snippets.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.snippets.map((snippet) => (
                      <li key={snippet} className="text-xs text-white/60">
                        <Marked text={snippet} term={term} />
                      </li>
                    ))}
                  </ul>
                )}
              </a>
            ))
          )}
        </div>
      )}

      {!searchActive && isAdmin && (
        <div>
          {showCreate ? (
            <div className="space-y-3 rounded border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap gap-3">
                <input
                  className={`${inputClass} min-w-64 flex-1`}
                  placeholder="Title (e.g. Closing checklist)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
                <label className="flex items-center gap-2 font-mono text-xs text-white/60">
                  section
                  <select
                    className={selectClass}
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={NEW_SECTION}>+ New section…</option>
                  </select>
                </label>
                {newCategory === NEW_SECTION && (
                  <input
                    className={`${inputClass} w-40`}
                    placeholder="New section name"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                  />
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SopAccessPicker
                  title="Who can view"
                  grant={newView}
                  staff={staff}
                  disabled={busy}
                  onChange={setNewView}
                />
                <SopAccessPicker
                  title="Who can edit"
                  hint="Anyone who can edit can also view."
                  grant={newEdit}
                  staff={staff}
                  disabled={busy}
                  onChange={setNewEdit}
                />
              </div>
              {assistEnabled && (
                <textarea
                  className={`${inputClass} min-h-24 w-full resize-y text-sm`}
                  placeholder="Rough notes (optional): the steps, what to watch for, who does it. The writing assistant turns them into a draft for you to review."
                  value={newNotes}
                  disabled={busy}
                  maxLength={20_000}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
              )}
              {newTitle.trim() && (
                <p className="font-mono text-[10px] text-white/40">
                  /admin/sops/{slugify(newTitle)}
                  {chosenCategory ? ` · ${chosenCategory}` : ''}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !newTitle.trim() || !chosenCategory}
                  onClick={() => void create()}
                >
                  Create
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  // Default to filing into an existing section; picking
                  // "+ New section…" is the deliberate choice.
                  setNewCategory(categories[0] ?? NEW_SECTION);
                  setShowCreate(true);
                }}
              >
                + New SOP
              </button>
              {showAddSection ? (
                <>
                  <input
                    className={`${inputClass} w-48`}
                    placeholder="Section name"
                    value={sectionDraft}
                    // biome-ignore lint/a11y/noAutofocus: focus the field the admin just opened
                    autoFocus
                    onChange={(e) => setSectionDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addSection();
                      if (e.key === 'Escape') {
                        setShowAddSection(false);
                        setSectionDraft('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy || !sectionDraft.trim()}
                    onClick={() => void addSection()}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => {
                      setShowAddSection(false);
                      setSectionDraft('');
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setShowAddSection(true)}
                >
                  + New section
                </button>
              )}
              <a href="/admin/sops/runs" className={buttonClass}>
                Runs
              </a>
              {printButton}
            </div>
          )}
        </div>
      )}

      {!searchActive && !isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <a href="/admin/sops/runs" className={buttonClass}>
            Runs
          </a>
          {printButton}
        </div>
      )}

      {!searchActive && printSelection && (
        <div className="sticky top-16 z-30 flex flex-wrap items-center gap-2 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-black)] p-3">
          <span className="font-mono text-xs text-white/70">
            {printSelection.size === 0
              ? 'Tap the SOPs to print'
              : `${printSelection.size} selected`}
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                setPrintSelection(
                  printSelection.size === sops.length ? new Set() : new Set(sops.map((s) => s.slug))
                )
              }
            >
              {printSelection.size === sops.length ? 'Select none' : 'Select all'}
            </button>
            <button
              type="button"
              className={goldButtonClass}
              disabled={printSelection.size === 0}
              onClick={printSelected}
            >
              Print {printSelection.size || ''}
            </button>
            <button type="button" className={buttonClass} onClick={() => setPrintSelection(null)}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {!searchActive && sops.length === 0 && (
        <p className="text-sm text-white/60">No SOPs you can view yet.</p>
      )}

      {!searchActive && pinnedSops.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
            ★ Pinned
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {pinnedSops.map((sop) => renderCard(sop, false))}
          </div>
        </section>
      )}

      {!searchActive &&
        categories.map((category) => {
          const inCategory = sops.filter((s) => s.category === category);
          const isDraggedCategory = drag?.kind === 'category' && drag.name === category;
          return (
            <section key={category}>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: passive drop target for the drag handles */}
              <div
                className={`mb-3 flex items-center gap-2 ${isDraggedCategory ? 'opacity-50' : ''}`}
                onDragEnter={() => enterCategory(category)}
              >
                {renaming === category ? (
                  <input
                    className={`${inputClass} w-48 py-1`}
                    value={renameDraft}
                    // biome-ignore lint/a11y/noAutofocus: focus the field the admin just opened
                    autoFocus
                    aria-label={`Rename the ${category} section`}
                    disabled={busy}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    // Blur is the only path that commits; Enter and Escape
                    // just blur, so a rename can't be sent twice.
                    onBlur={() => {
                      if (renameCancelledRef.current) {
                        renameCancelledRef.current = false;
                        setRenaming(null);
                        return;
                      }
                      void renameSection(category);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') {
                        renameCancelledRef.current = true;
                        e.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <h2 className="font-mono text-xs uppercase tracking-wide text-white/40">
                    {category}
                  </h2>
                )}
                {printSelection && inCategory.length > 0 && (
                  <button
                    type="button"
                    className={dragHandleClass}
                    title={`Select every SOP in ${category} for printing`}
                    onClick={() =>
                      togglePrint(
                        inCategory.map((s) => s.slug),
                        !inCategory.every((s) => printSelection.has(s.slug))
                      )
                    }
                  >
                    {inCategory.every((s) => printSelection.has(s.slug))
                      ? 'deselect section'
                      : 'select section'}
                  </button>
                )}
                {isAdmin && renaming !== category && !selecting && (
                  <>
                    <button
                      type="button"
                      className={dragHandleClass}
                      title="Drag to reorder sections"
                      aria-label={`Drag to reorder the ${category} section`}
                      draggable={!busy}
                      onDragStart={(e) => beginDrag(e, { kind: 'category', name: category })}
                      onDragEnd={endDrag}
                    >
                      ⠿
                    </button>
                    <button
                      type="button"
                      className={dragHandleClass}
                      title="Rename this section"
                      aria-label={`Rename the ${category} section`}
                      disabled={busy}
                      onClick={() => {
                        setRenameDraft(category);
                        setRenaming(category);
                      }}
                    >
                      rename
                    </button>
                    {/* Removing a section never touches documents, so the
                        control only appears once it holds none. */}
                    {inCategory.length === 0 && (
                      <button
                        type="button"
                        className={dragHandleClass}
                        title="Remove this empty section"
                        aria-label={`Remove the ${category} section`}
                        disabled={busy}
                        onClick={() => void deleteSection(category)}
                      >
                        ✕
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {inCategory.map((sop) => renderCard(sop, true))}
                {inCategory.length === 0 &&
                  (drag?.kind === 'sop' ? (
                    // A section emptied mid-drag stays visible as a drop zone
                    // so the move can be undone by dragging back.
                    // biome-ignore lint/a11y/noStaticElementInteractions: passive drop target for the drag handles
                    <div
                      onDragEnter={() => enterCategory(category)}
                      className="rounded border border-dashed border-white/20 p-4 text-center font-mono text-xs text-white/40"
                    >
                      drop here
                    </div>
                  ) : (
                    // A section with nothing in it yet — an admin just added
                    // it, or emptied it. Say so rather than rendering a bare
                    // header over blank space.
                    <p className="rounded border border-dashed border-white/10 p-4 text-center font-mono text-xs text-white/30">
                      {isAdmin ? 'No SOPs here yet — create one, or drag one in.' : 'No SOPs here.'}
                    </p>
                  ))}
              </div>
            </section>
          );
        })}

      {!searchActive && isAdmin && sops.length > 0 && (
        <p className="font-mono text-[10px] text-white/30">
          Drag the ⠿ handles to reorder — cards within or across sections, headers to reorder
          sections. Esc cancels a drag.
        </p>
      )}
    </div>
  );
}
