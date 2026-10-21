// Carrying a Pyre Agent conversation into a new session. When someone writes
// into a conversation whose agent session has ended, the new session is
// handed the conversation so far — every question and answer, oldest first —
// so the agent picks up where it left off. Pure and client-bundle-safe; the
// reads are in ./conversation.ts and the hand-over in /api/admin/knowledge-ask.
//
// The block is bounded (the newest turns win when it is long) and scrubbed of
// the delimiters the message uses, so nothing in an old answer can close the
// block early or pass itself off as the new question.

/** One earlier question and its answer. */
export interface CarriedTurn {
  question: string;
  answer: string | null;
}

/** The whole block stays under this; older turns drop off first. */
export const CARRY_MAX_CHARS = 24_000;
/** One answer is cut past this, so one long reply cannot crowd out the rest. */
export const CARRY_ANSWER_MAX_CHARS = 4_000;
const CARRY_QUESTION_MAX_CHARS = 2_000;

/** Remove the tags the message is built from, so carried text cannot close or forge them. */
function scrub(text: string): string {
  return text.replace(/<\/?\s*(staff-question|earlier-conversation)\b[^>]*>?/gi, '').trim();
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}\n… (cut)` : text;
}

/** One turn as it reads in the block. */
function turnText(turn: CarriedTurn, n: number): string {
  const question = cut(scrub(turn.question), CARRY_QUESTION_MAX_CHARS) || '(question not recorded)';
  const answer = turn.answer
    ? cut(scrub(turn.answer), CARRY_ANSWER_MAX_CHARS)
    : '(no answer was recorded)';
  return `### ${n}. Staff member\n${question}\n\n### ${n}. You answered\n${answer}`;
}

/**
 * The earlier conversation as a block for the new session's opening message,
 * or null when there is nothing to carry. `count` is how many turns made it in.
 */
export function buildCarryOver(
  turns: CarriedTurn[],
  maxChars = CARRY_MAX_CHARS
): { block: string; count: number; dropped: number } | null {
  const usable = turns.filter((t) => t.question.trim() || t.answer?.trim());
  if (usable.length === 0) return null;

  // Newest first until the budget runs out, then back into order.
  const kept: string[] = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const text = turnText(usable[i], i + 1);
    if (kept.length > 0 && used + text.length > maxChars) break;
    kept.unshift(text);
    used += text.length + 2;
  }
  const dropped = usable.length - kept.length;
  const lead =
    dropped > 0
      ? `(${dropped} earlier exchange${dropped === 1 ? '' : 's'} left out for length.)\n\n`
      : '';
  return {
    block: `<earlier-conversation>\n${lead}${kept.join('\n\n')}\n</earlier-conversation>`,
    count: kept.length,
    dropped,
  };
}
