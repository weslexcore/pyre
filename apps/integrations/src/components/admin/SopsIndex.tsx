// SOP library for /admin/sops: documents grouped by section (the free-text
// `category` on each document), filtered server-side to what the caller's role
// may view and sorted by the admin-managed section order. Admins get a create
// form (title, section, access levels), can add/rename/remove the sections
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
import { formatWhen } from './SopRunsList';

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
  pins: string[];
  /** The caller's own current-or-next shift duties; null when they hold none. */
  shiftSops: ShiftSops | null;
}

type Drag = { kind: 'sop'; id: string } | { kind: 'category'; name: string };

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

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const selectClass =
  'px-2 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

const handleClass =
  'cursor-grab touch-none rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/50 transition-colors hover:border-white/30 hover:text-white active:cursor-grabbing disabled:opacity-30';

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

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

export function SopsIndex() {
  const [sops, setSops] = useState<SopSummary[]>([]);
  const [people, setPeople] = useState<PeopleNames>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [role, setRole] = useState<SopRole>('staff');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  // Either an existing section name or NEW_SECTION, in which case the typed
  // `newCategoryName` is the section to create alongside the document.
  const [newCategory, setNewCategory] = useState<string>(NEW_SECTION);
  const [newCategoryName, setNewCategoryName] = useState('');
  // New documents start readable by everyone and editable by admins — the
  // same defaults the columns carry.
  const [newView, setNewView] = useState<SopGrant>({
    roles: ['staff', 'shift_lead', 'admin'],
    emails: [],
  });
  const [newEdit, setNewEdit] = useState<SopGrant>({ roles: ['admin'], emails: [] });
  const [staff, setStaff] = useState<GrantablePerson[]>([]);

  // Standalone "add a section" form, and the header being renamed in place.
  const [showAddSection, setShowAddSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Escape has to reach the blur that follows it, and state wouldn't have
  // re-rendered by then — the rename commits on blur alone, so this is how the
  // cancel gets there.
  const renameCancelledRef = useRef(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Unfinished runs on documents this role may view — runs are shared per
  // document, so someone else's open checklist is the one you walk up to and
  // continue.
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  // The session email, from the runs response, so the strip can put the
  // viewer's own open checklists first and label them as theirs.
  const [viewerEmail, setViewerEmail] = useState('');

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

  // The duty documents for the caller's own current-or-next shift, shown
  // above everything else: what you are about to do beats what is merely
  // filed on this page.
  const [shiftSops, setShiftSops] = useState<ShiftSops | null>(null);

  // The caller's pinned document ids (personal; shown in the Pinned strip).
  const [pins, setPins] = useState<Set<string>>(new Set());

  const togglePin = async (sop: SopSummary) => {
    const pinned = !pins.has(sop.id);
    // Optimistic flip; the response's authoritative list replaces it.
    setPins((prev) => {
      const next = new Set(prev);
      if (pinned) next.add(sop.id);
      else next.delete(sop.id);
      return next;
    });
    try {
      const res = await fetch('/api/admin/sop-pins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopId: sop.id, pinned }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { pins: string[] };
      setPins(new Set(body.pins));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update pin');
      await load({ silent: true });
    }
  };

  const [drag, setDrag] = useState<Drag | null>(null);
  // The order as of drag start, restored when the drag is cancelled.
  const snapshotRef = useRef<{ sops: SopSummary[]; categories: string[] } | null>(null);
  // Whether the drag ended on a valid drop target (vs Escape / outside).
  const droppedRef = useRef(false);
  // Last live-reorder target — dragenter refires for a target's children, and
  // replaying the same move would make adjacent items flicker.
  const lastEnterRef = useRef<string | null>(null);

  // silent = refresh the data without blanking the list (used to resync after
  // a failed reorder; the initial load shows the loading state).
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    // Silent refreshes keep any just-set error visible (e.g. "failed to save
    // the new order") instead of wiping it with the refetch.
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch('/api/admin/sops');
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as ListResponse;
      setSops(body.sops);
      // Server-supplied so sections holding nothing yet still get a header;
      // deriving from the documents would drop them.
      setCategories(body.categories ?? categoriesInOrder(body.sops));
      setRole(body.role);
      setStaff(body.staff ?? []);
      setPins(new Set(body.pins ?? []));
      setShiftSops(body.shiftSops ?? null);
      setPeople((prev) => ({ ...prev, ...body.people }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SOPs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Resume strip. Separate from the library load so a runs outage still leaves
  // a working SOP list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/sop-runs?view=active');
        if (!res.ok) return;
        const body = (await res.json()) as {
          runs?: ActiveRun[];
          people?: PeopleNames;
          viewer?: string;
        };
        if (!cancelled) {
          setActiveRuns(body.runs ?? []);
          setViewerEmail(body.viewer ?? '');
          // Whoever started an open run may not be an editor of any document,
          // so the strip brings its own names.
          setPeople((prev) => ({ ...prev, ...body.people }));
        }
      } catch {
        // Non-fatal: the library renders fine without the strip.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced library search; snippets come from the server so results only
  // ever cover documents this user may view.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/sops?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(await readError(res));
        const body = (await res.json()) as { results: SearchResult[] };
        setResults(body.results);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // The section the create form will file the document under: the chosen one,
  // or the name typed into the "new section" field.
  const chosenCategory = (newCategory === NEW_SECTION ? newCategoryName : newCategory).trim();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          // The API gives a brand-new section a position of its own, so a
          // section named here behaves exactly like one added on its own.
          category: chosenCategory || 'General',
          viewRoles: withAdmins(newView.roles),
          viewEmails: newView.emails,
          editRoles: withAdmins(newEdit.roles),
          editEmails: newEdit.emails,
          content: `# ${newTitle.trim()}\n`,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { sop } = (await res.json()) as { sop: SopRow };
      // Straight into the editor for the new document.
      window.location.href = `/admin/sops/${sop.slug}?edit=1`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create SOP');
      setBusy(false);
    }
  };

  // ---- sections ------------------------------------------------------------

  const addSection = async () => {
    const name = sectionDraft.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sop-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setSectionDraft('');
      setShowAddSection(false);
      // New sections land last and hold nothing — the reload is what puts the
      // (empty) header on screen.
      await load({ silent: true });
      // Pre-select it, so "add a section" flows straight into filling it.
      setNewCategory(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add the section');
    } finally {
      setBusy(false);
    }
  };

  const renameSection = async (name: string) => {
    const newName = renameDraft.trim();
    if (!newName || newName === name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sop-categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, newName }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setRenaming(null);
      // Every document in the section moved with it, so refetch rather than
      // patching names in place.
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename the section');
    } finally {
      setBusy(false);
    }
  };

  const deleteSection = async (name: string) => {
    if (!window.confirm(`Remove the "${name}" section? It has no SOPs in it.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sop-categories?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readError(res));
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove the section');
    } finally {
      setBusy(false);
    }
  };

  // ---- drag and drop -------------------------------------------------------

  const beginDrag = (e: React.DragEvent, next: Drag) => {
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers need data set for a drag to start at all.
    e.dataTransfer.setData('text/plain', next.kind === 'sop' ? next.id : next.name);
    snapshotRef.current = { sops, categories };
    droppedRef.current = false;
    lastEnterRef.current = null;
    setDrag(next);
  };

  const startSopDrag = (e: React.DragEvent, sop: SopSummary) => {
    // Drag image = the whole card, not the tiny handle the drag started on.
    const card = (e.currentTarget as HTMLElement).closest('[data-sop-card]');
    if (card instanceof HTMLElement) e.dataTransfer.setDragImage(card, 24, 24);
    beginDrag(e, { kind: 'sop', id: sop.id });
  };

  const enterSop = (targetId: string) => {
    if (busy || drag?.kind !== 'sop' || drag.id === targetId) return;
    if (lastEnterRef.current === `sop:${targetId}`) return;
    lastEnterRef.current = `sop:${targetId}`;
    setSops((prev) => repositionSop(prev, drag.id, targetId));
  };

  const enterCategory = (name: string) => {
    if (busy || !drag) return;
    if (drag.kind === 'category') {
      if (drag.name === name || lastEnterRef.current === `cat:${name}`) return;
      lastEnterRef.current = `cat:${name}`;
      setCategories((prev) => repositionCategory(prev, drag.name, name));
    } else {
      // A document dragged onto a section header (or empty section) goes to
      // that section's end.
      if (lastEnterRef.current === `end:${name}`) return;
      lastEnterRef.current = `end:${name}`;
      setSops((prev) => moveSopToCategoryEnd(prev, drag.id, name));
    }
  };

  const commit = async (finished: Drag) => {
    setBusy(true);
    setError(null);
    try {
      if (finished.kind === 'category') {
        const res = await fetch('/api/admin/sop-order', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories }),
        });
        if (!res.ok) throw new Error(await readError(res));
      } else {
        const moved = sops.find((s) => s.id === finished.id);
        if (!moved) return;
        // A cross-section drop changes the document's category first (the
        // settings PATCH), then the order within the new section.
        const original = snapshotRef.current?.sops.find((s) => s.id === finished.id);
        if (original && original.category !== moved.category) {
          const res = await fetch('/api/admin/sops', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: moved.id, category: moved.category }),
          });
          if (!res.ok) throw new Error(await readError(res));
        }
        const res = await fetch('/api/admin/sop-order', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: moved.category,
            sopIds: sops.filter((s) => s.category === moved.category).map((s) => s.id),
          }),
        });
        if (!res.ok) throw new Error(await readError(res));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the new order');
      // Resync (without blanking the list) so the view falls back to what the
      // server actually holds.
      await load({ silent: true });
    } finally {
      setBusy(false);
    }
    // On success there's nothing to refetch: the live-drag arrangement on
    // screen is exactly the order the server just stored.
  };

  const endDrag = () => {
    const finished = drag;
    setDrag(null);
    if (!finished) return;
    if (droppedRef.current) {
      void commit(finished);
    } else if (snapshotRef.current) {
      // Cancelled (Escape, or released outside) — put everything back.
      setSops(snapshotRef.current.sops);
      setCategories(snapshotRef.current.categories);
    }
  };

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  const isAdmin = role === 'admin';
  const searchActive = query.trim().length >= MIN_QUERY_LENGTH;
  const term = query.trim();
  const pinnedSops = sops.filter((s) => pins.has(s.id));

  // One card, used by both the category grid (draggable) and the Pinned strip
  // (plain). The star pins/unpins; a gold checklist badge marks runnable SOPs.
  const renderCard = (sop: SopSummary, draggable: boolean) => {
    const isDragged = draggable && drag?.kind === 'sop' && drag.id === sop.id;
    const isPinned = pins.has(sop.id);
    const activeRun = activeBySop.get(sop.id) ?? null;
    const activeIsMine = activeRun !== null && sameActor(activeRun.started_by, viewerEmail);
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: passive drop target for the drag handles
      <div
        key={sop.id}
        data-sop-card
        onDragEnter={draggable ? () => enterSop(sop.id) : undefined}
        className={`relative rounded border bg-white/5 transition-colors ${
          isDragged
            ? 'border-dashed border-white/40 opacity-40'
            : activeIsMine
              ? 'border-[var(--pyre-gold)] hover:border-[var(--pyre-gold)]'
              : activeRun
                ? 'border-[var(--pyre-gold)]/40 hover:border-[var(--pyre-gold)]'
                : 'border-white/10 hover:border-white/30'
        } ${sop.archived ? 'opacity-50' : ''}`}
      >
        <a href={`/admin/sops/${sop.slug}`} className="block p-4" draggable={false}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-[var(--pyre-creme)]">{sop.title}</h3>
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
          {draggable && isAdmin && (
            <button
              type="button"
              className={handleClass}
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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: passive drop surface; drags start from keyboard-focusable button handles
    <div
      className="space-y-8"
      // The whole library is one drop surface: dragover/drop bubble up here,
      // so releasing anywhere inside commits the live arrangement.
      onDragOver={(e) => {
        if (drag) e.preventDefault();
      }}
      onDrop={(e) => {
        if (drag) {
          e.preventDefault();
          droppedRef.current = true;
        }
      }}
    >
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

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
                    {actorLabel(run.started_by, viewerEmail, people)} · {formatWhen(run.started_at)}
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
            </div>
          )}
        </div>
      )}

      {!searchActive && !isAdmin && (
        <div>
          <a href="/admin/sops/runs" className={buttonClass}>
            Runs
          </a>
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
                {isAdmin && renaming !== category && (
                  <>
                    <button
                      type="button"
                      className={handleClass}
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
                      className={handleClass}
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
                        className={handleClass}
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
