// A markdown textarea with internal-link autocomplete, used by every markdown
// field in the dashboard (SOPs, messages and replies, card notes, goal
// descriptions): once the href of a markdown link starts with "/", a dropdown
// under the caret lists the SOPs and admin pages the signed-in user may open
// (served by /api/admin/link-targets, ranked by lib/sops/link-suggest.ts,
// drawn by LinkPicker). Arrow keys move, Enter or Tab picks, Escape hides the
// list until the next link. Picking writes the full href and the closing
// paren in one go, so a finished link is always well-formed.
import {
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  applyLink,
  type LinkContext,
  type LinkTarget,
  linkContextAt,
  suggestLinks,
} from '@/lib/sops/link-suggest';
import { caretAnchor, LinkPicker } from './LinkPicker';

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'onKeyDown' | 'onKeyUp' | 'onClick' | 'onBlur' | 'onScroll'
> & {
  value: string;
  onChange: (next: string) => void;
  /** A page that shouldn't suggest itself — the SOP being edited, say. */
  excludeHref?: string;
};

// One fetch serves every field on the page (a card drawer and a reply box
// can be open together). The client router keeps this module alive between
// admin pages, so the list is refetched once it is a minute old — long
// enough to share, short enough that a new SOP shows up.
const TARGETS_TTL_MS = 60_000;
let cached: { at: number; promise: Promise<LinkTarget[]> } | null = null;

function loadTargets(): Promise<LinkTarget[]> {
  if (cached && Date.now() - cached.at < TARGETS_TTL_MS) return cached.promise;
  const promise = fetch('/api/admin/link-targets')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { targets: LinkTarget[] };
      return body.targets;
    })
    .catch((err: unknown) => {
      // Don't keep a failure around; the next field to mount tries again.
      cached = null;
      throw err;
    });
  cached = { at: Date.now(), promise };
  return promise;
}

export function LinkTextarea({ value, onChange, excludeHref, disabled, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [loaded, setLoaded] = useState<LinkTarget[] | null>(null);
  const [context, setContext] = useState<LinkContext | null>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  // Start offset of the link the user hit Escape on — the picker stays away
  // from that one, and reappears for the next.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  // Caret to restore after a pick re-renders the textarea.
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTargets()
      .then((list) => {
        if (!cancelled) setLoaded(list);
      })
      .catch(() => {
        // Without the list the textarea still works; there is just no picker.
        if (!cancelled) setLoaded([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const targets = loaded && excludeHref ? loaded.filter((t) => t.href !== excludeHref) : loaded;

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
    // Respect the field's cap rather than write past it.
    if (rest.maxLength !== undefined && result.text.length > rest.maxLength) return;
    pendingCaret.current = result.caret;
    setContext(null);
    onChange(result.text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      // Keep the Escape from closing a drawer or dialog the field sits in.
      e.stopPropagation();
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
        {...rest}
        ref={ref}
        value={value}
        disabled={disabled}
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
        <LinkPicker
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
