import { describe, expect, it } from 'vitest';
import {
  assignmentChangeText,
  boardCommentText,
  cardAssignedText,
  cardCompletedText,
  goalCompletedText,
  intakeCardText,
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

describe('goals and boards text', () => {
  it('names the assigner, the noun, and where the card sits', () => {
    expect(
      cardAssignedText({
        cardTitle: 'Call the caterer',
        assignerName: 'Wes',
        noun: 'task',
        goalTitle: 'Staff run the space without us',
        dueDate: '2026-10-01',
      })
    ).toEqual({
      title: 'Wes put a task on you: Call the caterer',
      body: 'under Staff run the space without us · due Thu, Oct 1',
    });
  });

  it('leaves the detail line empty when there is no goal and no date', () => {
    expect(
      cardAssignedText({ cardTitle: 'Call the caterer', assignerName: 'Wes', noun: 'lead' }).body
    ).toBe('');
  });

  it('truncates a long title rather than filling the row with it', () => {
    const long = 'x'.repeat(200);
    const { title } = cardAssignedText({ cardTitle: long, assignerName: 'Wes', noun: 'task' });
    expect(title.length).toBeLessThan(100);
    expect(title.endsWith('…')).toBe(true);
  });

  it('says which column a finished card landed in', () => {
    expect(
      cardCompletedText({
        cardTitle: 'Call the caterer',
        finisherName: 'Julien',
        columnLabel: 'Done',
        noun: 'task',
      })
    ).toEqual({ title: 'Julien moved your task to Done', body: 'Call the caterer' });
  });

  it("prefers the founder's own note to the counts on a completed goal", () => {
    expect(
      goalCompletedText({
        goalTitle: 'Staff run the space',
        finisherName: 'Wes',
        kpisMet: 1,
        kpisTotal: 2,
        openCards: 3,
        note: 'Four weeks with nobody on site.',
      })
    ).toEqual({
      title: 'Wes marked "Staff run the space" completed',
      body: 'Four weeks with nobody on site.',
    });
  });

  it('falls back to the counts when no note was written', () => {
    expect(
      goalCompletedText({
        goalTitle: 'Staff run the space',
        finisherName: 'Wes',
        kpisMet: 1,
        kpisTotal: 2,
        openCards: 1,
        note: '   ',
      }).body
    ).toBe('1 of 2 KPIs met, 1 task still open');
  });

  it('says nothing extra when a goal was met clean', () => {
    expect(
      goalCompletedText({
        goalTitle: 'Staff run the space',
        finisherName: 'Wes',
        kpisMet: 2,
        kpisTotal: 2,
        openCards: 0,
      }).body
    ).toBe('2 of 2 KPIs met');
  });

  it('marks an intake lead as having come from the web', () => {
    expect(
      intakeCardText({
        cardTitle: 'Group of 12, Oct 3',
        boardName: 'Rental & group leads',
        noun: 'lead',
      })
    ).toEqual({
      title: 'New lead: Group of 12, Oct 3',
      body: 'Came in from the web, on Rental & group leads',
    });
  });

  it('says where else a card came in from', () => {
    expect(
      intakeCardText({
        cardTitle: 'Group of 12, Oct 3',
        boardName: 'Rental & group leads',
        noun: 'lead',
        via: 'the form',
      }).body
    ).toBe('Came in from the form, on Rental & group leads');
  });

  it('carries a comment excerpt under the commenter', () => {
    expect(
      boardCommentText({
        subjectTitle: 'Call the caterer',
        commenterName: 'Maya',
        excerpt: 'They want a deposit first.',
      })
    ).toEqual({
      title: 'Maya commented on Call the caterer',
      body: 'They want a deposit first.',
    });
  });
});
