// The bare branded HTML page the email-link endpoints (unsubscribe, claim,
// partner decision, sub claim) answer with — no layout, no JS, noindex.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const BASE_STYLE =
  'body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}h1{font-size:1.25rem}';

export interface HtmlPageOptions {
  /** Goes after "Pyre — " in the <title>; already HTML, not escaped. */
  title: string;
  /** Inner HTML under the "Pyre Sauna" heading. */
  body: string;
  status?: number;
  /** Extra CSS appended to the base style. */
  style?: string;
}

export function htmlPage({ title, body, status = 200, style = '' }: HtmlPageOptions): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pyre — ${title}</title><style>${BASE_STYLE}${style}</style></head><body><h1>Pyre Sauna</h1>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
