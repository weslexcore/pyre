// Classify one piece of staff-written text with Jev: the probability, per
// signal type, that the text carries it. Thresholds and storage are the
// integrations app's business (parseSignals in @pyre/signals-core); this
// returns the raw answers so a threshold change never needs a re-run.

import type { SignalType, SubjectType } from '@pyre/signals-core';
import { evaluate, JEV_MODEL } from '../jev';
import { classifyQuestions, classifyState } from './questions';

export interface ClassifyResult {
  model: string;
  probabilities: Partial<Record<SignalType, number>>;
}

export async function classifyText(
  subject: SubjectType,
  text: string,
  options: { abortSignal?: AbortSignal; fetch?: typeof fetch } = {}
): Promise<ClassifyResult> {
  const result = await evaluate({
    state: classifyState(subject, text),
    questions: classifyQuestions(subject),
    abortSignal: options.abortSignal,
    fetch: options.fetch,
  });
  const probabilities: Partial<Record<SignalType, number>> = {};
  for (const [type, answer] of Object.entries(result.answers) as [SignalType, { probability: number }][]) {
    probabilities[type] = answer.probability;
  }
  return { model: JEV_MODEL, probabilities };
}
