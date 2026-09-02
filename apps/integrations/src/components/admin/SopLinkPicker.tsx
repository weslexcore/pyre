// Autocomplete dropdown for internal links in the SOP editor. Appears under
// the caret while an href starting with "/" is being typed (see
// lib/sops/link-suggest.ts for the detection and ranking) and lists library
// documents and admin pages; the editor owns the keyboard handling and just
// tells this component which row is active.
import { useLayoutEffect, useRef } from 'react';
import type { LinkTarget } from '@/lib/sops/link-suggest';

interface Props {
  items: LinkTarget[];
  activeIndex: number;
  /** Pixel offset of the caret inside the textarea's positioned wrapper. */
  anchor: { top: number; left: number };
  onPick: (target: LinkTarget) => void;
  onHover: (index: number) => void;
}

// Styles that shape text flow in a textarea; the mirror copies them so its
// line breaks fall where the textarea's do.
const MIRROR_PROPS = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'tabSize',
  'textIndent',
  'textTransform',
  'wordSpacing',
] as const;

/**
 * Where the caret sits inside the textarea, relative to its top-left corner
 * and accounting for scroll — measured with an off-screen mirror of the text
 * up to the caret, the standard trick since textareas expose no caret
 * geometry themselves. `top` is the bottom edge of the caret's line, so a
 * dropdown placed there hangs just under the text being typed.
 */
export function caretAnchor(textarea: HTMLTextAreaElement): { top: number; left: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.style.height = 'auto';

  const caret = textarea.selectionStart;
  mirror.textContent = textarea.value.slice(0, caret);
  const marker = document.createElement('span');
  // A zero-width marker at the caret; the space keeps a trailing newline from
  // collapsing so the marker really lands on the new line.
  marker.textContent = textarea.value.slice(caret, caret + 1) || ' ';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
  const top = marker.offsetTop + lineHeight - textarea.scrollTop;
  const left = marker.offsetLeft - textarea.scrollLeft;
  document.body.removeChild(mirror);
  return { top, left };
}

export function SopLinkPicker({ items, activeIndex, anchor, onPick, onHover }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-selected row in view as it moves.
  useLayoutEffect(() => {
    const row = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Link to"
      className="absolute z-40 max-h-64 w-80 max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border border-white/15 bg-[var(--pyre-black)] py-1 shadow-lg"
      style={{ top: anchor.top + 4, left: Math.max(0, anchor.left) }}
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-white/40">No matching pages</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.href}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left ${
              i === activeIndex ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
            // Mouse down would blur the textarea and close the picker before
            // the click lands; picking on mouse down keeps focus where it is.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="flex w-full items-baseline gap-2">
              <span className="truncate text-sm text-[var(--pyre-creme)]">{item.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/40">
                {item.kind === 'sop' ? 'modal' : 'page'}
              </span>
            </span>
            <span className="w-full truncate font-mono text-[10px] text-white/40">
              {item.detail} · {item.href}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
