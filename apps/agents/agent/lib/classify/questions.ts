// The questions a classification puts to Jev, built from @pyre/signals-core:
// one boolean per signal type that applies to the subject. Jev answers each
// independently with P(true), so a note can carry any mix of signals (Jev has
// no multi-label question type; independent booleans are the multi-label).
// A new signal type in the registry becomes a new question here with no edit.

import {
  MAX_CLASSIFY_TEXT,
  SIGNAL_DEFINITIONS,
  type SignalType,
  type SubjectType,
  sanitizeClassifyText,
  subjectDefinition,
} from '@pyre/signals-core';
import type { Experimental_EvaluationQuestion as EvaluationQuestion } from 'ai';

export function classifyQuestions(subject: SubjectType): Record<SignalType, EvaluationQuestion> {
  const applies = new Set<string>(subjectDefinition(subject).signals);
  const questions = {} as Record<SignalType, EvaluationQuestion>;
  for (const d of SIGNAL_DEFINITIONS) {
    if (!applies.has(d.key)) continue;
    questions[d.key] = {
      type: 'boolean',
      instructions: `Does the text carry this signal? ${d.label}: ${d.definition}`,
      criteria: {
        true: { means: d.definition, examples: d.examples },
        false: `Nothing in the text is a "${d.label.toLowerCase()}" in this sense.`,
      },
    };
  }
  return questions;
}

/** The state Jev reads: what kind of text this is, and the text itself. */
export function classifyState(
  subject: SubjectType,
  text: string
): { kind: string; context: string; text: string } {
  const d = subjectDefinition(subject);
  return {
    kind: d.label,
    context: d.context,
    text: sanitizeClassifyText(text).slice(0, MAX_CLASSIFY_TEXT),
  };
}
