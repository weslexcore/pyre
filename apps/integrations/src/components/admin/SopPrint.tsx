// The printable SOP documents for /admin/sops/print. Rendered on the server
// only (no client directive): black on white, no dashboard chrome, and each
// document starting on a fresh page.
//
// Each document is laid out as a table whose <tfoot> holds its footer —
// browsers repeat a table's footer group on every printed page the table
// spans, which is the one way to get a per-document running footer (CSS
// paged-media running elements aren't supported). So a three-page SOP carries
// its version, change time and editor on all three sheets, and the next SOP
// in the stack carries its own.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderable } from './SopMarkdown';

export interface PrintableSop {
  id: string;
  title: string;
  category: string;
  content_md: string;
  footer: string;
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center border border-black align-[-2px] text-[10px] leading-none"
    >
      {checked ? '✓' : ''}
    </span>
  );
}

function PrintMarkdown({ content }: { content: string }) {
  return (
    <div className="text-[11pt] leading-snug [&_ul_ul]:my-1 [&_ul_ul]:pl-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 className="mt-5 mb-2 text-[15pt] font-semibold">{children}</h2>,
          h2: ({ children }) => (
            <h3 className="mt-5 mb-2 border-b border-black/30 pb-1 text-[13pt] font-semibold break-after-avoid">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 mb-1.5 text-[11.5pt] font-semibold break-after-avoid">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
          li: ({ children, className }) =>
            className?.includes('task-list-item') ? (
              <li className="break-inside-avoid">{children}</li>
            ) : (
              <li className="ml-5 list-disc break-inside-avoid">{children}</li>
            ),
          input: ({ checked }) => <Checkbox checked={checked === true} />,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-black/40 pl-3 italic">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded border border-black/20 px-1 font-mono text-[9.5pt]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-hidden border border-black/20 p-2 whitespace-pre-wrap [&_code]:border-0 [&_code]:p-0">
              {children}
            </pre>
          ),
          // Paper can't follow a link: keep the text, drop the target.
          a: ({ children }) => <span className="underline">{children}</span>,
          table: ({ children }) => (
            <table className="my-2 w-full border-collapse text-[10pt]">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border border-black/40 px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-black/40 px-2 py-1 align-top">{children}</td>
          ),
          hr: () => <hr className="my-4 border-black/30" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          img: ({ src, alt }) => <img src={src} alt={alt ?? ''} className="my-2 max-h-[4in]" />,
        }}
      >
        {renderable(content)}
      </ReactMarkdown>
    </div>
  );
}

export function SopPrint({ sops }: { sops: PrintableSop[] }) {
  return (
    <>
      {sops.map((sop, i) => (
        <table
          key={sop.id}
          className={`w-full border-collapse ${i > 0 ? 'mt-16 print:mt-0 print:break-before-page' : ''}`}
        >
          <tbody>
            <tr>
              <td className="p-0 align-top">
                <article>
                  <header className="mb-4 border-b-2 border-black pb-2">
                    <p className="font-mono text-[8pt] uppercase tracking-wide text-black/60">
                      Pyre SOP · {sop.category}
                    </p>
                    <h1 className="text-[20pt] leading-tight font-semibold">{sop.title}</h1>
                  </header>
                  <PrintMarkdown content={sop.content_md} />
                </article>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="p-0">
                <p className="mt-6 border-t border-black/40 pt-1.5 font-mono text-[8pt] text-black/70">
                  {sop.title} · {sop.footer}
                </p>
              </td>
            </tr>
          </tfoot>
        </table>
      ))}
    </>
  );
}
