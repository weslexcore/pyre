// Static-markup render of the conversation list: a conversation a saved
// routine opened is listed under the routine's name with a Routine marker;
// one the person started is listed by its first question.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AskHistory } from './AskHistory';

const now = new Date().toISOString();

function render(conversations: Parameters<typeof AskHistory>[0]['conversations']) {
  return renderToStaticMarkup(
    <AskHistory
      conversations={conversations}
      activeSessionId={null}
      openingSessionId={null}
      loading={false}
      error={null}
      busy={false}
      onSelect={() => {}}
      onNew={() => {}}
      isAdmin={false}
    />
  );
}

describe('AskHistory', () => {
  it('marks a routine conversation and names it after the routine', () => {
    const html = render([
      {
        sessionId: 's1',
        title: 'Read every shift note from the past seven days and summarize…',
        startedAt: now,
        lastAt: now,
        turnCount: 1,
        routine: { routineId: 'r1', title: 'Weekly shift notes summary' },
      },
    ]);
    expect(html).toContain('Weekly shift notes summary');
    expect(html).toContain('>Routine<');
    expect(html).toContain('title="Routine: Weekly shift notes summary"');
    expect(html).not.toContain('Read every shift note');
  });

  it('leaves a conversation the person started unmarked', () => {
    const html = render([
      {
        sessionId: 's2',
        title: 'When is my next shift?',
        startedAt: now,
        lastAt: now,
        turnCount: 2,
      },
    ]);
    expect(html).toContain('When is my next shift?');
    expect(html).not.toContain('>Routine<');
  });
});
