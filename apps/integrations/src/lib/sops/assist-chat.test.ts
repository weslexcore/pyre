import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHAT,
  hasUnsentReplies,
  openRound,
  reply,
  SKIPPED_ANSWER,
  sendEarly,
  toConversation,
} from './assist-chat';

describe('assistant chat', () => {
  it('asks one question at a time and sends once the round is answered', () => {
    const state = openRound(EMPTY_CHAT, null, ['Which oxidizer?', 'How many gallons?']);
    expect(state.messages.map((m) => m.text)).toEqual(['Which oxidizer?']);
    expect(state.asking).toBe(true);

    const first = reply(state, ' MPS ');
    expect(first.send).toBe(false);
    expect(first.state.messages.at(-1)?.text).toBe('How many gallons?');

    const second = reply(first.state, '', { skipped: true });
    expect(second.send).toBe(true);
    expect(second.state.asking).toBe(false);
    expect(toConversation(second.state)).toEqual([
      { role: 'assistant', text: 'Which oxidizer?' },
      { role: 'user', text: 'MPS' },
      { role: 'assistant', text: 'How many gallons?' },
      { role: 'user', text: SKIPPED_ANSWER },
    ]);
  });

  it('opens the next round with the reply and drops questions already asked', () => {
    const answered = reply(openRound(EMPTY_CHAT, null, ['Which oxidizer?']), 'MPS').state;
    const next = openRound(answered, 'Filled in the product.', ['which oxidizer?', 'Who logs it?']);
    expect(next.messages.slice(-2).map((m) => m.text)).toEqual([
      'Filled in the product.',
      'Who logs it?',
    ]);
    expect(next.queue).toEqual([]);
  });

  it('sends a request straight away when nothing is being asked', () => {
    const done = openRound(EMPTY_CHAT, 'All set.', []);
    expect(done.asking).toBe(false);
    const { send } = reply(done, 'Make the goggles step required');
    expect(send).toBe(true);
  });

  it('can send early, leaving the rest for later', () => {
    const state = reply(openRound(EMPTY_CHAT, null, ['A?', 'B?', 'C?']), 'a').state;
    expect(hasUnsentReplies(state, 0)).toBe(true);
    const early = sendEarly(state);
    expect(early.queue).toEqual([]);
    expect(early.asking).toBe(false);
    expect(hasUnsentReplies(early, early.messages.length)).toBe(false);
  });
});
