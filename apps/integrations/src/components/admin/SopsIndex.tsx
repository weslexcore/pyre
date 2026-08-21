// SOP library for /admin/sops: documents grouped by category, filtered
// server-side to what the caller's role may view and sorted by the
// admin-managed category order. Admins get a create form (title, category,
// access levels), see archived documents, and reorder by drag and drop: the
// ⠿ handle on a card moves a document within its section or into another
// section, the handle on a section header reorders sections. The arrangement
// updates live while dragging (native HTML5 drag events, no library) and
// persists on drop via /api/admin/sop-order; releasing outside a drop target
// (or pressing Escape) restores the previous order. The API enforces the real
// guards — this island just mirrors them.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SopRow } from '@/lib/db';
import {
  ACCESS_LABELS,
  SOP_ACCESS_LEVELS,
  type SopAccessLevel,
  type SopRole,
  slugify,
} from '@/lib/sops/levels';
import {
  categoriesInOrder,
  moveSopToCategoryEnd,
  repositionCategory,
  repositionSop,
} from '@/lib/sops/order';
import { highlightSegments, MIN_QUERY_LENGTH } from '@/lib/sops/search';

type SopSummary = Omit<SopRow, 'content_md'> & { task_count: number };

interface ListResponse {
  sops: SopSummary[];
  role: SopRole;
  pins: string[];
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

function AccessBadge({ level, kind }: { level: SopAccessLevel; kind: 'view' | 'edit' }) {
  // "All staff" view access is the default and not worth a badge.
  if (kind === 'view' && level === 'staff') return null;
  const color = level === 'admin' ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-gold)]';
  return (
    <span className={`font-mono text-[10px] uppercase tracking-wide ${color}`}>
      {kind === 'view' ? 'view' : 'edit'}: {ACCESS_LABELS[level].toLowerCase()}
    </span>
  );
}

export function SopsIndex() {
  const [sops, setSops] = useState<SopSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [role, setRole] = useState<SopRole>('staff');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [newView, setNewView] = useState<SopAccessLevel>('staff');
  const [newEdit, setNewEdit] = useState<SopAccessLevel>('admin');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

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
      setCategories(categoriesInOrder(body.sops));
      setRole(body.role);
      setPins(new Set(body.pins ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SOPs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          category: newCategory.trim() || 'General',
          viewAccess: newView,
          editAccess: newEdit,
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
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: passive drop target for the drag handles
      <div
        key={sop.id}
        data-sop-card
        onDragEnter={draggable ? () => enterSop(sop.id) : undefined}
        className={`relative rounded border bg-white/5 transition-colors ${
          isDragged
            ? 'border-dashed border-white/40 opacity-40'
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
            {sop.updated_by && sop.updated_by !== 'seed' ? ` by ${sop.updated_by}` : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-3">
            {sop.task_count > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                ☑ checklist · {sop.task_count} tasks
              </span>
            )}
            <AccessBadge level={sop.view_access} kind="view" />
            <AccessBadge level={sop.edit_access} kind="edit" />
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
                <input
                  className={`${inputClass} w-40`}
                  placeholder="Category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                />
                <label className="flex items-center gap-2 font-mono text-xs text-white/60">
                  view
                  <select
                    className={selectClass}
                    value={newView}
                    onChange={(e) => setNewView(e.target.value as SopAccessLevel)}
                  >
                    {SOP_ACCESS_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {ACCESS_LABELS[l]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 font-mono text-xs text-white/60">
                  edit
                  <select
                    className={selectClass}
                    value={newEdit}
                    onChange={(e) => setNewEdit(e.target.value as SopAccessLevel)}
                  >
                    {SOP_ACCESS_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {ACCESS_LABELS[l]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {newTitle.trim() && (
                <p className="font-mono text-[10px] text-white/40">
                  /admin/sops/{slugify(newTitle)}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !newTitle.trim()}
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
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} onClick={() => setShowCreate(true)}>
                + New SOP
              </button>
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
            My runs
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
                <h2 className="font-mono text-xs uppercase tracking-wide text-white/40">
                  {category}
                </h2>
                {isAdmin && (
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
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {inCategory.map((sop) => renderCard(sop, true))}
                {inCategory.length === 0 && drag?.kind === 'sop' && (
                  // A section emptied mid-drag stays visible as a drop zone so
                  // the move can be undone by dragging back.
                  // biome-ignore lint/a11y/noStaticElementInteractions: passive drop target for the drag handles
                  <div
                    onDragEnter={() => enterCategory(category)}
                    className="rounded border border-dashed border-white/20 p-4 text-center font-mono text-xs text-white/40"
                  >
                    drop here
                  </div>
                )}
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
