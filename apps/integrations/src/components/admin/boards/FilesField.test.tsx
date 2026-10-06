import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AttachmentSummary } from '@/lib/boards/files';
import { FilesField } from './FilesField';

const file: AttachmentSummary = {
  id: 'a0000000-0000-4000-8000-000000000001',
  card_id: 'card',
  field_key: 'contract',
  event_id: null,
  file_name: 'a-long-signed-contract-name.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  kind: 'document',
};

function render(props: { readOnly?: boolean } = {}) {
  return renderToStaticMarkup(
    <FilesField
      id="f"
      label="Contract"
      value={[file.id]}
      known={[file]}
      action="/upload"
      params={{}}
      href={(id, download) => `/media?id=${id}${download ? '&download=1' : ''}`}
      onChange={() => undefined}
      {...props}
    />
  );
}

/** The markup of the element that holds `text`, from its opening tag to its close. */
function rowHolding(html: string, text: string): string {
  const at = html.indexOf(text);
  const open = html.lastIndexOf('<div', at);
  return html.slice(open, html.indexOf('</div>', at));
}

describe('a file tile', () => {
  it('keeps download and remove on their own line, apart from the name and size', () => {
    const html = render();
    const nameRow = rowHolding(html, file.file_name);
    expect(nameRow).toContain('2 KB');
    expect(nameRow).not.toContain('Download');
    expect(nameRow).not.toContain('Remove');
    const actions = rowHolding(html, '>Download<');
    expect(actions).toContain('Remove');
    expect(actions).toContain('flex-wrap');
  });

  it('offers only download when the files are read-only', () => {
    const html = render({ readOnly: true });
    expect(html).toContain('>Download<');
    expect(html).not.toContain('Remove');
  });
});
