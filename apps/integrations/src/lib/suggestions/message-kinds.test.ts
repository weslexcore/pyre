import { describe, expect, it } from 'vitest';
import { isSuggestTool, suggestionIdOf, suggestionIdsIn } from '@/lib/pyre-agent/types';
import { describeSuggestion, parsePayload, sourceHref } from './types';

const UUID = '0b6c1f8e-2f9a-4c1e-9a55-6a1d2b3c4d5e';

describe('parsePayload message.create', () => {
  it('reads a message with its audience and defaults', () => {
    expect(
      parsePayload('message.create', {
        title: '  Cold tubs closed Thursday ',
        bodyMd: 'Both tubs are being drained.\n',
        audienceRoles: ['staff', 'staff'],
        audienceEmails: ['Maya@Example.com'],
      })
    ).toEqual({
      ok: true,
      value: {
        title: 'Cold tubs closed Thursday',
        bodyMd: 'Both tubs are being drained.',
        audienceRoles: ['staff'],
        audienceEmails: ['maya@example.com'],
        requiresAck: false,
        pinned: false,
      },
    });
  });

  it('needs a title, a body, and someone to send it to', () => {
    expect(parsePayload('message.create', { bodyMd: 'x', audienceRoles: ['staff'] }).ok).toBe(
      false
    );
    expect(parsePayload('message.create', { title: 'x', audienceRoles: ['staff'] }).ok).toBe(false);
    expect(parsePayload('message.create', { title: 'x', bodyMd: 'y', audienceRoles: [] })).toEqual({
      ok: false,
      error: 'Pick at least one role or person',
    });
    expect(
      parsePayload('message.create', { title: 'x', bodyMd: 'y', audienceRoles: ['guests'] }).ok
    ).toBe(false);
  });
});

describe('parsePayload message.edit', () => {
  it('keeps the message as it stood, for the diff and the conflict check', () => {
    expect(
      parsePayload('message.edit', {
        messageId: UUID,
        title: 'Hours',
        bodyMd: 'Open 7–9',
        baseUpdatedAt: '2026-11-16T10:00:00Z',
        previousTitle: 'Hours',
        previousBodyMd: 'Open 7–8',
      })
    ).toEqual({
      ok: true,
      value: {
        messageId: UUID,
        title: 'Hours',
        bodyMd: 'Open 7–9',
        baseUpdatedAt: '2026-11-16T10:00:00Z',
        previousTitle: 'Hours',
        previousBodyMd: 'Open 7–8',
        sent: true,
      },
    });
  });

  it('refuses a message that is not named by id', () => {
    expect(parsePayload('message.edit', { messageId: 'monday', title: 'x', bodyMd: 'y' }).ok).toBe(
      false
    );
  });
});

describe('describing message suggestions', () => {
  it('says what each would do', () => {
    expect(describeSuggestion('message.create', { title: 'Towel order' })).toBe(
      'New message: Towel order'
    );
    expect(describeSuggestion('message.edit', { title: 'New hours', previousTitle: 'Hours' })).toBe(
      'Edit message: Hours'
    );
  });
});

describe('Pyre Agent as a source', () => {
  it('links to the conversation', () => {
    expect(sourceHref('pyre_agent', 'sess_abc')).toBe('/admin/ask?c=sess_abc');
  });

  it('finds the suggestion a suggest tool filed', () => {
    expect(isSuggestTool('suggest_sop_edit')).toBe(true);
    expect(isSuggestTool('propose_card')).toBe(false);
    expect(suggestionIdOf(JSON.stringify({ suggestion: { id: UUID } }))).toBe(UUID);
    expect(suggestionIdOf(JSON.stringify({ proposal: { id: UUID } }))).toBeNull();
    expect(suggestionIdOf('not json')).toBeNull();
    // A batch (inventory changes) carries every id, in order.
    const OTHER = '9d1e2f3a-4b5c-4d6e-8f70-112233445566';
    expect(suggestionIdsIn(JSON.stringify({ suggestions: [{ id: UUID }, { id: OTHER }] }))).toEqual(
      [UUID, OTHER]
    );
    expect(suggestionIdsIn(JSON.stringify({ suggestion: { id: UUID } }))).toEqual([UUID]);
    expect(suggestionIdsIn(undefined)).toEqual([]);
  });
});
