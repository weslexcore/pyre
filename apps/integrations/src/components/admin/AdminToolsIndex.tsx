// Directory of tool cards for the /admin dashboard, with per-user pinning:
// the star on a card pins it into a "Pinned" section at the top, whose ⠿
// handles reorder by drag and drop (native HTML5 drag events, no library —
// the SopsIndex pattern: the arrangement updates live while dragging, drop
// commits, Escape or releasing outside restores). Every change PUTs the
// complete pinned list to /api/admin/tool-pins and announces the saved list
// on a CustomEvent so the AdminNav menu on the same page stays in step. The
// API enforces the real guards — this island just mirrors them.
import { useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { dragHandleClass } from '@/components/admin/ui';
import { normalizePins, repositionPin, TOOL_PINS_EVENT, togglePin } from '@/lib/admin/pinOrder';
import { readError } from '@/lib/client/api';
import { useLiveReorder } from '@/lib/client/useLiveReorder';
import { ADMIN_TOOL_SECTIONS, type AdminTool } from './adminTools';

interface AdminToolsIndexProps {
  /** Pre-filtered by the page to the tools this user may view. */
  tools: AdminTool[];
  /** The caller's saved pin order, hrefs as stored (may hold stale entries). */
  initialPins: string[];
  /** All permitted tools, including hidden ones, so editing visible pins preserves them. */
  validPinHrefs?: string[];
}

export function AdminToolsIndex({
  tools,
  initialPins,
  validPinHrefs = tools.map((tool) => tool.href),
}: AdminToolsIndexProps) {
  const [pins, setPins] = useState<string[]>(() => normalizePins(initialPins, validPinHrefs));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toolByHref = new Map(tools.map((tool) => [tool.href, tool]));
  const pinnedSet = new Set(pins);
  const pinnedTools = pins
    .map((href) => toolByHref.get(href))
    .filter((tool): tool is AdminTool => !!tool);
  const sections = ADMIN_TOOL_SECTIONS.filter((s) => tools.some((t) => t.section === s.key));

  const save = async (next: string[], previous: string[]) => {
    setPins(next); // optimistic — the PUT response replaces it
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/tool-pins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hrefs: next }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const saved = ((await res.json()) as { hrefs?: string[] }).hrefs ?? next;
      const normalized = normalizePins(saved, validPinHrefs);
      setPins(normalized);
      document.dispatchEvent(new CustomEvent(TOOL_PINS_EVENT, { detail: normalized }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save pins');
      setPins(previous);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (href: string) => {
    if (busy) return;
    void save(togglePin(pins, href), pins);
  };

  // ---- drag and drop -------------------------------------------------------

  const reorder = useLiveReorder<string, string[]>({
    // The live-drag arrangement on screen is the order to store; skip the
    // network round-trip when the drop changed nothing.
    onDrop: (_href, before) => {
      if (before && before.join('\n') !== pins.join('\n')) void save(pins, before);
    },
    onCancel: setPins,
  });
  const drag = reorder.drag;

  const startDrag = (e: React.DragEvent, href: string) =>
    reorder.begin(e, href, pins, href, '[data-pin-card]');

  const enterPin = (targetHref: string) => {
    if (busy || !drag || drag === targetHref) return;
    if (!reorder.enterOnce(targetHref)) return;
    setPins((prev) => repositionPin(prev, drag, targetHref));
  };

  const endDrag = reorder.end;

  // One card, used by both the Pinned grid (draggable, unpin star) and the
  // section grids (pin/unpin star only).
  const renderCard = (tool: AdminTool, inPinned: boolean) => {
    const isDragged = inPinned && drag === tool.href;
    const isPinned = pinnedSet.has(tool.href);
    return (
      <li
        key={tool.href}
        data-pin-card={inPinned ? true : undefined}
        onDragEnter={inPinned ? () => enterPin(tool.href) : undefined}
        className={`relative rounded-lg border bg-white/5 transition-colors ${
          isDragged
            ? 'border-dashed border-white/40 opacity-40'
            : 'border-white/10 hover:border-white/30 hover:bg-white/10'
        }`}
      >
        <a href={tool.href} draggable={false} className="block px-4 py-4">
          <div
            className={`font-mono text-sm font-bold uppercase tracking-wide text-[var(--pyre-creme)] ${
              inPinned ? 'pr-14' : 'pr-8'
            }`}
          >
            {tool.title}
          </div>
          <p className="mt-1 text-xs text-white/50">{tool.description}</p>
        </a>
        <span className="absolute top-3 right-3 flex gap-1">
          <button
            type="button"
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors disabled:opacity-30 ${
              isPinned
                ? 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)]'
                : 'border-white/10 bg-white/5 text-white/40 hover:border-white/30 hover:text-white'
            }`}
            title={isPinned ? 'Unpin' : 'Pin to top'}
            aria-label={isPinned ? `Unpin ${tool.title}` : `Pin ${tool.title} to top`}
            disabled={busy}
            onClick={() => toggle(tool.href)}
          >
            {isPinned ? '★' : '☆'}
          </button>
          {inPinned && (
            <button
              type="button"
              className={dragHandleClass}
              title="Drag to reorder"
              aria-label={`Drag to reorder ${tool.title}`}
              draggable={!busy}
              onDragStart={(e) => startDrag(e, tool.href)}
              onDragEnd={endDrag}
            >
              ⠿
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <div
      className="space-y-8"
      // The whole directory is one drop surface: dragover/drop bubble up here,
      // so releasing anywhere inside commits the live arrangement.
      {...reorder.surface}
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {pinnedTools.length > 0 && (
        <section>
          <h2 className="border-b border-white/10 pb-2 font-mono text-xs font-bold uppercase tracking-wide text-[var(--pyre-gold)]">
            ★ Pinned
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {pinnedTools.map((tool) => renderCard(tool, true))}
          </ul>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.key}>
          <h2 className="border-b border-white/10 pb-2 font-mono text-xs font-bold uppercase tracking-wide text-white/40">
            {section.label}
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {tools
              .filter((tool) => tool.section === section.key)
              .map((tool) => renderCard(tool, false))}
          </ul>
        </section>
      ))}
    </div>
  );
}
