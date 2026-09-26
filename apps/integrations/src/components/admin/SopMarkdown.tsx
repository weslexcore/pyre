// Markdown renderer for SOP documents (view mode and edit preview). GFM so
// the seeded checklists' task lists work; no typography plugin in this app,
// so each element is styled inline for the dark admin theme. Task-list
// checkboxes render disabled here — the live, persisted checkboxes belong to
// ChecklistView; everywhere this component shows a task line (edit preview,
// the peek modal, prose edge cases) it is reference material, and a tickable
// box that saves nothing would be a lie.
//
// `onSopLink` turns links to other library documents (/admin/sops/<slug>)
// into buttons that open the peek modal instead of navigating; without it
// they stay plain links.
//
// `lineBreaks` keeps every line the writer typed on its own line — for text
// written as notes rather than as markdown (shift notes and their replies),
// where "Towels low\nHeater slow" is two things, not one sentence. Markdown
// proper (lists, checklists, headings, fences) is unaffected.
//
// `highlight` wraps every occurrence of the term in <mark> for the in-document
// search: every text node is a direct string child of one of the overridden
// elements below, so marking string children in each override covers the
// whole document.
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sopSlugFromHref } from '@/lib/sops/links';
import { highlightSegments, MIN_QUERY_LENGTH } from '@/lib/sops/search';

const MARK_CLASS = 'rounded-sm bg-[var(--pyre-gold)] px-0.5 text-[var(--pyre-black)]';

function CopyableCodeBlock({ children }: { children?: ReactNode }) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timeout = setTimeout(() => setStatus('idle'), 2500);
    return () => clearTimeout(timeout);
  }, [status]);

  async function copy() {
    if (!codeRef.current) return;
    try {
      // textContent preserves whitespace and excludes any search-highlight markup.
      await navigator.clipboard.writeText(codeRef.current.textContent ?? '');
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded border border-white/10 bg-white/5">
      <div className="flex items-center justify-end gap-2 border-b border-white/10 px-3 py-1.5">
        <span role="status" className="text-xs text-white/60">
          {status === 'copied' ? 'Copied!' : status === 'error' ? 'Unable to copy. Try again.' : ''}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code block"
          className="cursor-pointer rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--pyre-gold)]"
        >
          Copy
        </button>
      </div>
      <pre ref={codeRef} className="overflow-x-auto p-3">
        {children}
      </pre>
    </div>
  );
}

/**
 * Turn each single line break outside a code fence into a hard break (two
 * trailing spaces), the way remark-breaks would: a line followed by another
 * non-blank line would otherwise be joined to it in one paragraph. Lines that
 * start a list item, heading, quote or table already stand alone, so the
 * extra spaces are harmless there. Exported for tests.
 */
export function keepLineBreaks(content: string): string {
  const lines = content.split('\n');
  let fenced = false;
  return lines
    .map((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const next = lines[i + 1];
      if (fenced || next === undefined || !line.trim() || !next.trim()) return line;
      return /\s{2}$/.test(line) ? line : `${line}  `;
    })
    .join('\n');
}

/** A required task line (`- [!] text`) — see lib/sops/checklist. */
const REQUIRED_TASK_RE = /^(\s*[-*+]\s+)\[!\]\s+/gm;

/**
 * GFM knows `[ ]` and `[x]`, not the library's `[!]` for an item that can't
 * be skipped: left alone it would render as a literal "[!]" and lose the
 * checkbox entirely. Rewrite it into an ordinary unchecked box that says so,
 * which is what the edit preview and the peek modal want anyway — the live
 * checklist never comes through here, since ChecklistView pulls task lines
 * out of the document and renders its own rows.
 */
function renderable(content: string): string {
  if (!content.includes('[!]')) return content;
  return content.replace(REQUIRED_TASK_RE, '$1[ ] `Required` ');
}

/**
 * A stable id for a heading, so a document can link to its own sections
 * ([Safety](#safety)) — quick-reference summaries up top jump to the detail
 * below. Derived from the heading's plain text the same way GitHub does:
 * lowercase, punctuation dropped, spaces to hyphens. Element children (a
 * link inside a heading) contribute nothing, which is fine for a slug.
 */
export function headingId(children: ReactNode): string | undefined {
  const nodes = Array.isArray(children) ? children : [children];
  const text = nodes.filter((c): c is string => typeof c === 'string').join('');
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return slug.length > 0 ? slug : undefined;
}

function markString(text: string, term: string, keyBase: string): ReactNode[] {
  return highlightSegments(text, term).map((segment, i) =>
    segment.match ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
      <mark key={`${keyBase}-${i}`} className={MARK_CLASS}>
        {segment.text}
      </mark>
    ) : (
      segment.text
    )
  );
}

// Memoized: a checklist renders one of these per task row, and a tap must
// not re-parse every other row's markdown.
export const SopMarkdown = memo(function SopMarkdown({
  content,
  highlight,
  onSopLink,
  lineBreaks = false,
  className = '',
}: {
  content: string;
  highlight?: string;
  onSopLink?: (slug: string) => void;
  /** Keep single line breaks as line breaks (see the header). */
  lineBreaks?: boolean;
  /** Extra classes on the wrapper, e.g. to trim the outer margins in a card. */
  className?: string;
}) {
  const term = highlight?.trim() ?? '';
  const active = term.length >= MIN_QUERY_LENGTH;

  // Marks the string children of one element; element children are left for
  // their own overrides.
  const hl = (children: ReactNode): ReactNode => {
    if (!active) return children;
    const nodes = Array.isArray(children) ? children : [children];
    return nodes.map((child, i) =>
      typeof child === 'string' ? markString(child, term, String(i)) : child
    );
  };

  return (
    // Descendant rules handle nested lists (sub-tasks under a checklist item):
    // tighter vertical rhythm and their own indent, overriding the top-level
    // ul classes below.
    <div
      className={`text-sm leading-relaxed text-white/80 [&_ul_ul]:my-1 [&_ul_ul]:pl-7 ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2
              id={headingId(children)}
              className="mt-8 mb-3 text-xl font-semibold text-[var(--pyre-creme)] first:mt-0"
            >
              {hl(children)}
            </h2>
          ),
          h2: ({ children }) => (
            <h3
              id={headingId(children)}
              className="mt-8 mb-3 border-b border-white/10 pb-1.5 text-lg font-semibold text-[var(--pyre-creme)] first:mt-0"
            >
              {hl(children)}
            </h3>
          ),
          h3: ({ children }) => (
            <h4
              id={headingId(children)}
              className="mt-6 mb-2 text-base font-semibold text-[var(--pyre-creme)]"
            >
              {hl(children)}
            </h4>
          ),
          p: ({ children }) => <p className="my-3">{hl(children)}</p>,
          ul: ({ children }) => <ul className="my-3 space-y-1.5 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>,
          // Task items keep block flow (a flex row would drag any nested
          // sub-task list up beside the text) with the checkbox inline.
          li: ({ children, className }) =>
            className?.includes('task-list-item') ? (
              <li>{hl(children)}</li>
            ) : (
              <li className="ml-4 list-disc">{hl(children)}</li>
            ),
          input: ({ checked }) => (
            <input
              type="checkbox"
              checked={checked === true}
              disabled
              readOnly
              className="mr-2 h-4 w-4 align-[-3px] opacity-60 accent-[var(--pyre-gold)]"
            />
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-[var(--pyre-gold)] pl-3 text-white/70 italic">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">
              {hl(children)}
            </code>
          ),
          pre: CopyableCodeBlock,
          a: ({ children, href }) => {
            const slug = sopSlugFromHref(href);
            if (slug && onSopLink) {
              return (
                <button
                  type="button"
                  onClick={() => onSopLink(slug)}
                  aria-haspopup="dialog"
                  className="cursor-pointer text-[var(--pyre-gold)] underline hover:text-white"
                >
                  {hl(children)}
                </button>
              );
            }
            // Off-site links (research citations, vendor pages) open in a new
            // tab so the reader keeps their place in the library.
            const external = /^https?:\/\//i.test(href ?? '');
            return (
              <a
                href={href}
                className="text-[var(--pyre-gold)] underline hover:text-white"
                rel="noopener noreferrer"
                target={external ? '_blank' : undefined}
              >
                {hl(children)}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-white/10 bg-white/5 px-2 py-1 text-left font-mono text-xs uppercase tracking-wide text-white/60">
              {hl(children)}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-white/10 px-2 py-1 align-top">{hl(children)}</td>
          ),
          hr: () => <hr className="my-6 border-white/10" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--pyre-creme)]">{hl(children)}</strong>
          ),
          em: ({ children }) => <em className="italic">{hl(children)}</em>,
        }}
      >
        {lineBreaks ? keepLineBreaks(renderable(content)) : renderable(content)}
      </ReactMarkdown>
    </div>
  );
});
