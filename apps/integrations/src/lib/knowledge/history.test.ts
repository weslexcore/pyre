import { describe, expect, it } from 'vitest';
import { conversationTitle, groupConversations, TITLE_MAX_LENGTH } from './history';

describe('conversationTitle', () => {
  it('keeps a short one-line question as is', () => {
    expect(conversationTitle('  When was the left tub last shocked?  ')).toBe(
      'When was the left tub last shocked?'
    );
  });

  it('uses only the first line of a multi-line question', () => {
    expect(conversationTitle('What do we tell a pregnant guest?\nShe wants to plunge.')).toBe(
      'What do we tell a pregnant guest?'
    );
  });

  it('cuts a long question with an ellipsis within the row limit', () => {
    const title = conversationTitle('x'.repeat(200));
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
  });

  it('falls back when nothing was recorded', () => {
    expect(conversationTitle('')).toBe('Untitled conversation');
    expect(conversationTitle('\n  \n')).toBe('Untitled conversation');
  });
});

describe('groupConversations', () => {
  const rows = [
    { session_id: 'b', question: 'Follow-up in b', asked_at: '2026-09-02T12:05:00Z' },
    { session_id: 'a', question: 'Only question in a', asked_at: '2026-09-02T11:00:00Z' },
    { session_id: 'b', question: 'First question in b', asked_at: '2026-09-02T09:00:00Z' },
    { session_id: 'c', question: 'Old chat', asked_at: '2026-08-30T08:00:00Z' },
  ];

  it('folds rows into one conversation per session, newest activity first', () => {
    const result = groupConversations(rows);
    expect(result.map((c) => c.sessionId)).toEqual(['b', 'a', 'c']);
    expect(result[0]).toEqual({
      sessionId: 'b',
      title: 'First question in b',
      startedAt: '2026-09-02T09:00:00Z',
      lastAt: '2026-09-02T12:05:00Z',
      turnCount: 2,
    });
    expect(result[1]?.turnCount).toBe(1);
  });

  it('titles a conversation by its earliest recorded question, skipping blank rows', () => {
    const result = groupConversations([
      { session_id: 's', question: '', asked_at: '2026-09-02T09:00:00Z' },
      { session_id: 's', question: 'Recorded later', asked_at: '2026-09-02T09:01:00Z' },
    ]);
    expect(result[0]?.title).toBe('Recorded later');
    expect(result[0]?.startedAt).toBe('2026-09-02T09:00:00Z');
  });

  it('titles a conversation with nothing recorded yet as untitled', () => {
    const result = groupConversations([
      { session_id: 's', question: '', asked_at: '2026-09-02T09:00:00Z' },
    ]);
    expect(result[0]?.title).toBe('Untitled conversation');
  });

  it('caps the list', () => {
    expect(groupConversations(rows, 2).map((c) => c.sessionId)).toEqual(['b', 'a']);
  });

  it('is empty for no rows', () => {
    expect(groupConversations([])).toEqual([]);
  });
});
