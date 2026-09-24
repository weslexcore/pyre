// Static-markup render of the header's quick-add button and the composer it
// opens, plus the summary line shown once a note lands.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShiftNoteAttachmentRow, ShiftNoteRow } from '@/lib/db';
import { QuickShiftNote } from './QuickShiftNote';
import { type CreatedShiftNote, createdNotice } from './ShiftNoteComposer';

function created(attached: number): CreatedShiftNote {
  return {
    note: { id: 'n1', note_date: '2026-09-24' } as ShiftNoteRow,
    attachments: Array.from({ length: attached }, (_, i) => ({
      id: `a${i}`,
    })) as ShiftNoteAttachmentRow[],
    people: {},
  };
}

describe('QuickShiftNote', () => {
  it('draws a labelled plus button with the modal closed', () => {
    const html = renderToStaticMarkup(<QuickShiftNote />);
    expect(html).toContain('aria-label="Add a shift note"');
    expect(html).toContain('aria-expanded="false"');
    // The composer is mounted but hidden, so a closed modal keeps its draft.
    const overlay = /<div class="([^"]*fixed inset-0[^"]*)"/.exec(html)?.[1] ?? '';
    expect(overlay.split(' ')).toContain('hidden');
  });

  it('offers text, a camera shot, and photo / video uploads', () => {
    const html = renderToStaticMarkup(<QuickShiftNote />);
    expect(html).toContain('What&#x27;s worth noting');
    expect(html).toContain('No need to wait for the end of your shift');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('Add photos / video');
    expect(html).toMatch(/role="dialog"[^>]*aria-labelledby="([^"]+)"/);
  });
});

describe('createdNotice', () => {
  it('names the day and counts what was attached', () => {
    expect(createdNotice(created(2), 2)).toBe('Note added for Thursday, Sep 24. 2 files attached.');
  });

  it('flags files that did not make it onto the note', () => {
    expect(createdNotice(created(1), 2)).toContain('1 file could not be attached');
  });
});
