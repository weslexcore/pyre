import { describe, expect, it } from 'vitest';
import {
  assignmentChangeText,
  proposalApprovedText,
  shiftChangeText,
  shiftNoteReplyText,
  shiftNoteStatusText,
  shortWindow,
  sopSavedText,
  subRequestText,
} from './text';

const shift = {
  label: 'Morning',
  shift_date: '2026-09-20',
  starts_at: '09:00:00',
  ends_at: '13:30:00',
};

describe('assignmentChangeText', () => {
  it('describes being added, with the personal window and role', () => {
    expect(
      assignmentChangeText({
        change: 'added',
        shift,
        assignment: { starts_at: '10:00:00', ends_at: '13:30:00', role: 'setup' },
        actorName: 'Wes',
      })
    ).toEqual({ title: "You're on 'Morning' on Sun, Sep 20", body: '10a–1:30p · setup by Wes' });
  });

  it('falls back to the shift window and omits a full role', () => {
    expect(assignmentChangeText({ change: 'removed', shift, assignment: null })).toEqual({
      title: "You were taken off 'Morning' on Sun, Sep 20",
      body: '9a–1:30p',
    });
  });

  it('uses the diff detail for an update', () => {
    expect(
      assignmentChangeText({ change: 'updated', shift, detail: 'starts_at 09:00 → 10:00' }).body
    ).toBe('starts_at 09:00 → 10:00');
  });
});

describe('shiftChangeText', () => {
  it('names cancelled, removed, and changed shifts', () => {
    expect(shiftChangeText({ change: 'cancelled', shift }).title).toBe(
      "Shift cancelled: 'Morning' on Sun, Sep 20"
    );
    expect(shiftChangeText({ change: 'deleted', shift }).title).toBe(
      "Shift removed: 'Morning' on Sun, Sep 20"
    );
    expect(shiftChangeText({ change: 'updated', shift, actorName: 'Wes' }).body).toBe(
      'Now 9a–1:30p by Wes'
    );
  });
});

describe('sopSavedText', () => {
  it('prefers the change note, else the version', () => {
    expect(
      sopSavedText({ title: 'Opening', version: 4, created: false, changeNote: 'Fixed step 3' })
    ).toEqual({
      title: 'SOP updated: Opening',
      body: 'Fixed step 3',
    });
    expect(
      sopSavedText({ title: 'Opening', version: 4, created: false, editorName: 'Wes' }).body
    ).toBe('Version 4 by Wes');
    expect(sopSavedText({ title: 'Opening', version: 1, created: true }).title).toBe(
      'New SOP: Opening'
    );
  });
});

describe('subRequestText', () => {
  const window = { starts_at: '09:00:00', ends_at: '13:00:00' };
  it('asks candidates and tells admins', () => {
    expect(
      subRequestText({
        event: 'requested',
        shift,
        window,
        requesterName: 'Ana',
        forCandidate: true,
      })
    ).toEqual({
      title: "Can you cover 'Morning' on Sun, Sep 20, 9a–1p?",
      body: 'Ana needs a sub',
    });
    expect(subRequestText({ event: 'requested', shift, window, requesterName: 'Ana' }).title).toBe(
      'Ana requested a sub'
    );
  });

  it('tells the requester who is covering', () => {
    expect(
      subRequestText({
        event: 'claimed',
        shift,
        window,
        requesterName: 'Ana',
        claimerName: 'Bo',
        forRequester: true,
      }).title
    ).toBe('Bo is covering your shift');
    expect(
      subRequestText({ event: 'claimed', shift, window, requesterName: 'Ana', claimerName: 'Bo' })
        .title
    ).toBe('Bo is covering for Ana');
  });
});

describe('shift note text', () => {
  it('addresses the author directly', () => {
    expect(
      shiftNoteReplyText({
        noteDate: '2026-09-13',
        replierName: 'Wes',
        forAuthor: true,
        excerpt: 'ok',
      })
    ).toEqual({
      title: 'Wes replied to your shift note for Sun, Sep 13',
      body: 'ok',
    });
    expect(
      shiftNoteReplyText({
        noteDate: '2026-09-13',
        replierName: 'Ana',
        forAuthor: false,
        authorName: "Ana's",
        excerpt: 'x',
      }).title
    ).toBe("Ana replied on Ana's shift note for Sun, Sep 13");
    expect(
      shiftNoteStatusText({ noteDate: '2026-09-13', status: 'todo', adminName: 'Wes' })
    ).toEqual({
      title: 'Your shift note for Sun, Sep 13 was marked to-do',
      body: 'by Wes',
    });
  });
});

describe('misc', () => {
  it('pluralises the proposal summary', () => {
    expect(proposalApprovedText({ weekStart: '2026-09-21', shiftCount: 1 }).title).toBe(
      '1 shift published for the week of Mon, Sep 21'
    );
    expect(
      proposalApprovedText({ weekStart: '2026-09-21', shiftCount: 3, actorName: 'Wes' }).body
    ).toBe('Schedule approved by Wes');
  });

  it('formats compact windows', () => {
    expect(shortWindow({ starts_at: '00:00:00', ends_at: '12:15:00' })).toBe('12a–12:15p');
  });
});
