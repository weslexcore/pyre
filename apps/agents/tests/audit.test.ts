import { describe, expect, it } from 'vitest';
import { extractQuestion } from '../agent/lib/knowledge/audit';

describe('extractQuestion', () => {
  it('pulls the question out of the dashboard wrapper', () => {
    const message =
      'A staff member asked the question below. Answer it from the knowledge base.\n' +
      '<staff-question>\nWhat are the benefits of cold plunging?\n</staff-question>';
    expect(extractQuestion(message)).toBe('What are the benefits of cold plunging?');
  });

  it('falls back to the whole message, trimmed and capped', () => {
    expect(extractQuestion('  plain text  ')).toBe('plain text');
    expect(extractQuestion('x'.repeat(5000))).toHaveLength(2000);
  });
});
