// Markdown renderer for SOP documents (view mode and edit preview). GFM so
// the seeded checklists' task lists work; no typography plugin in this app,
// so each element is styled inline for the dark admin theme. Task-list
// checkboxes are left enabled — staff tick items off as they run a checklist
// (client-side only, resets on reload; the document itself is never mutated).
//
// `highlight` wraps every occurrence of the term in <mark> for the in-document
// search: every text node is a direct string child of one of the overridden
// elements below, so marking string children in each override covers the
// whole document.
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightSegments, MIN_QUERY_LENGTH } from '@/lib/sops/search';

const MARK_CLASS = 'rounded-sm bg-[var(--pyre-gold)] px-0.5 text-[var(--pyre-black)]';

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

export function SopMarkdown({ content, highlight }: { content: string; highlight?: string }) {
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
    <div className="text-sm leading-relaxed text-white/80 [&_ul_ul]:my-1 [&_ul_ul]:pl-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-8 mb-3 text-xl font-semibold text-[var(--pyre-creme)] first:mt-0">
              {hl(children)}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-8 mb-3 border-b border-white/10 pb-1.5 text-lg font-semibold text-[var(--pyre-creme)] first:mt-0">
              {hl(children)}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-6 mb-2 text-base font-semibold text-[var(--pyre-creme)]">
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
              defaultChecked={checked === true}
              className="mr-2 h-4 w-4 align-[-3px] accent-[var(--pyre-gold)]"
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
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded border border-white/10 bg-white/5 p-3">
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-[var(--pyre-gold)] underline hover:text-white"
              rel="noopener noreferrer"
            >
              {hl(children)}
            </a>
          ),
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
