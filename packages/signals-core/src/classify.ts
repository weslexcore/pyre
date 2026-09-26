// Classify one piece of staff-written text with Jev (@pyre/jev): one yes/no
// question per signal type that applies to the subject, built from the
// registry. Jev answers each independently with P(true), so a note can carry
// any mix of signals (Jev has no multi-label question type; independent
// booleans are the multi-label). A new signal type in the registry becomes a
// new question here with no edit.

import { askJevBooleans, type EvaluationQuestion, JEV_MODEL, type JevOptions } from '@pyre/jev';
import { MAX_CLASSIFY_TEXT, sanitizeClassifyText } from './message';
import { SIGNAL_DEFINITIONS, type Signal, type SignalDefinition, type SignalType } from './signals';
import { type SubjectType, subjectDefinition } from './subjects';
import { parseSignals } from './validate';

type BooleanQuestion = EvaluationQuestion & { type: 'boolean' };

export function classifyQuestions(subject: SubjectType): Record<SignalType, BooleanQuestion> {
  const applies = new Set<string>(subjectDefinition(subject).signals);
  const questions = {} as Record<SignalType, BooleanQuestion>;
  for (const d of SIGNAL_DEFINITIONS as readonly SignalDefinition[]) {
    if (!applies.has(d.key)) continue;
    questions[d.key as SignalType] = {
      type: 'boolean',
      instructions: `Does the text carry this signal? ${d.label}: ${d.definition}`,
      criteria: {
        true: { means: d.definition, examples: d.examples },
        // Look-alikes the signal must not fire on (e.g. work already done
        // for "action"), when the registry names them.
        false: d.notThis
          ? { means: d.notThis.means, examples: d.notThis.examples }
          : `Nothing in the text is a "${d.label.toLowerCase()}" in this sense.`,
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

export interface ClassifyResult {
  model: string;
  /** The signals at or above their thresholds, most likely first. */
  signals: Signal[];
}

/** Ask Jev which signals `text` carries. Throws when Jev fails or answers out of range. */
export async function classifySignals(
  subject: SubjectType,
  text: string,
  options: JevOptions = {}
): Promise<ClassifyResult> {
  const probabilities = await askJevBooleans(
    classifyState(subject, text),
    classifyQuestions(subject),
    options
  );
  const parsed = parseSignals(probabilities, subject);
  if (!parsed.ok) throw new Error(`Jev answer rejected: ${parsed.error}`);
  return { model: JEV_MODEL, signals: parsed.signals };
}
