// Static-markup render of the shift note lightbox: the current item full
// size, a position counter and Previous / Next only when there is more than
// one item to browse, and a video rendered as a player rather than an image.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShiftNoteAttachmentRow } from '@/lib/db';
import { ShiftNoteViewer } from './ShiftNoteViewer';

function item(id: string, kind: ShiftNoteAttachmentRow['kind']): ShiftNoteAttachmentRow {
  return {
    id,
    note_id: 'note-1',
    storage_path: `notes/${id}`,
    file_name: `${id}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    mime_type: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    size_bytes: 1234,
    kind,
    uploaded_by: 'marina@pyresauna.com',
    created_at: '2026-09-01T14:00:00Z',
  };
}

const noop = () => {};

describe('ShiftNoteViewer', () => {
  it('shows the current photo with its position and navigation', () => {
    const html = renderToStaticMarkup(
      <ShiftNoteViewer
        items={[item('a', 'photo'), item('b', 'photo'), item('c', 'photo')]}
        index={1}
        onNavigate={noop}
        onClose={noop}
      />
    );
    expect(html).toContain('<img');
    expect(html).toContain('/api/admin/shift-note-media?id=b');
    expect(html).toContain('2 / 3');
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
    expect(html).toContain('download=1');
  });

  it('hides the counter and navigation for a single item', () => {
    const html = renderToStaticMarkup(
      <ShiftNoteViewer items={[item('a', 'photo')]} index={0} onNavigate={noop} onClose={noop} />
    );
    expect(html).not.toContain('1 / 1');
    expect(html).not.toContain('Previous');
    expect(html).not.toContain('Next');
  });

  it('renders a video item as a player', () => {
    const html = renderToStaticMarkup(
      <ShiftNoteViewer
        items={[item('a', 'photo'), item('v', 'video')]}
        index={1}
        onNavigate={noop}
        onClose={noop}
      />
    );
    expect(html).toContain('<video');
    expect(html).toContain('controls');
    expect(html).not.toContain('<img');
  });

  it('renders nothing when the index is out of range', () => {
    const html = renderToStaticMarkup(
      <ShiftNoteViewer items={[]} index={0} onNavigate={noop} onClose={noop} />
    );
    expect(html).toBe('');
  });
});
