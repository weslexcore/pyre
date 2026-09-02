// The SOP editor's markdown textarea, with internal-link autocomplete: once
// the href of a markdown link starts with "/", a dropdown under the caret
// lists the library's documents and the admin pages (lib/sops/link-suggest.ts
// ranks them; SopLinkPicker draws them). Arrow keys move, Enter or Tab picks,
// Escape hides the list until the next link. Picking writes the full href and
// the closing paren in one go, so a finished link is always well-formed.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  applyLink,
  type LinkContext,
  type LinkTarget,
  linkContextAt,
  suggestLinks,
} from '@/lib/sops/link-suggest';
import { ADMIN_TOOLS } from './adminTools';
import { caretAnchor, SopLinkPicker } from './SopLinkPicker';

interface Props {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  /** The document being edited; it's left out of its own suggestions. */
  currentSlug: string;
  className?: string;
}

interface ListedSop {
  slug: string;
  title: string;
  category: string;
  archived: boolean;
}

/** Documents the caller may read plus every admin page, as link targets. */
async function loadTargets(currentSlug: string): Promise<LinkTarget[]> {
  const res = await fetch('/api/admin/sops');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { sops: ListedSop[] };
  const sops: LinkTarget[] = body.sops
    .filter((sop) => !sop.archived && sop.slug !== currentSlug)
    .map((sop) => ({
      href: `/admin/sops/${sop.slug}`,
      title: sop.title,
      detail: sop.category,
      kind: 'sop',
    }));
  const pages: LinkTarget[] = ADMIN_TOOLS.map((tool) => ({
    href: tool.href,
    title: tool.title,
    detail: tool.description,
    kind: 'page',
  }));
  return [...sops, ...pages];
}

export function SopLinkTextarea({ value, disabled, onChange, currentSlug, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [targets, setTargets] = useState<LinkTarget[] | null>(null);
  const [context, setContext] = useState<LinkContext | null>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  // Start offset of the link the admin hit Escape on — the picker stays away
  // from that one, and reappears for the next.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  // Caret to restore after a pick re-renders the textarea.
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTargets(currentSlug)
      .then((list) => {
        if (!cancelled) setTargets(list);
      })
      .catch(() => {
        // Without the list the textarea still works; there is just no picker.
        if (!cancelled) setTargets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentSlug]);

  // After a pick, the controlled value re-renders the textarea with the
  // caret at the end; put it back just past the link. Cheap enough to check
  // on every render, which is what lets it run for the very render that
  // carries the new value.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = ref.current;
    if (caret === null || !el) return;
    pendingCaret.current = null;
    el.setSelectionRange(caret, caret);
    el.focus();
  });

  // Re-derive the link-in-progress from the caret; runs on every edit and
  // caret move so the list follows the text.
  const sync = useCallback(
    (el: HTMLTextAreaElement) => {
      const next =
        el.selectionStart === el.selectionEnd ? linkContextAt(el.value, el.selectionStart) : null;
      if (!next || next.start === dismissedStart) {
        setContext(null);
        return;
      }
      if (next.start !== context?.start) setActiveIndex(0);
      if (dismissedStart !== null) setDismissedStart(null);
      setContext(next);
      setAnchor(caretAnchor(el));
    },
    [context?.start, dismissedStart]
  );

  const items = context && targets ? suggestLinks(targets, context.query) : [];
  const open = context !== null && targets !== null && targets.length > 0;

  const pick = (target: LinkTarget) => {
    const el = ref.current;
    if (!el || !context) return;
    const result = applyLink(el.value, context, el.selectionStart, target.href);
    pendingCaret.current = result.caret;
    setContext(null);
    onChange(result.text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedStart(context?.start ?? null);
      setContext(null);
      return;
    }
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(items[Math.min(activeIndex, items.length - 1)]);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          // Arrow-key caret moves inside a link update the query; the
          // navigation keys are handled on key down and skipped here.
          if (open && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
          sync(e.currentTarget);
        }}
        onClick={(e) => sync(e.currentTarget)}
        onBlur={() => setContext(null)}
        onScroll={(e) => {
          if (context) setAnchor(caretAnchor(e.currentTarget));
        }}
      />
      {open && (
        <SopLinkPicker
          items={items}
          activeIndex={Math.min(activeIndex, Math.max(0, items.length - 1))}
          anchor={anchor}
          onPick={pick}
          onHover={setActiveIndex}
        />
      )}
    </div>
  );
}
