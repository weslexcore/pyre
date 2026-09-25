// Classify one piece of staff-written text with Jev, TypeSafe AI's System One
// evaluation model: the probability, per signal type, that the text carries
// it. Jev answers typed questions instead of writing prose, so this goes
// through eve's `evaluate` (eve/ai, the AI SDK evaluation API with eve's
// model authentication) rather than a language-model call; Jev is its
// default model and resolves through Vercel AI Gateway with the same
// credentials the agent's language models use (AI_GATEWAY_API_KEY locally,
// OIDC on Vercel). Thresholds and storage are the integrations app's business
// (parseSignals in @pyre/signals-core); this returns the raw answers so a
// threshold change never needs a re-run.

import type { SignalType, SubjectType } from '@pyre/signals-core';
import type { Experimental_EvaluationModel as EvaluationModel } from 'ai';
import { evaluate } from 'eve/ai';
import { classifyQuestions, classifyState } from './questions';

/** Jev through AI Gateway (also eve's default evaluation model). */
export const JEV_MODEL = 'typesafe-ai/jev';

export interface ClassifyResult {
  model: string;
  probabilities: Partial<Record<SignalType, number>>;
}

export async function classifyText(
  subject: SubjectType,
  text: string,
  options: { abortSignal?: AbortSignal; model?: EvaluationModel } = {}
): Promise<ClassifyResult> {
  const result = await evaluate({
    model: options.model ?? JEV_MODEL,
    state: classifyState(subject, text),
    questions: classifyQuestions(subject),
    abortSignal: options.abortSignal,
  });
  const probabilities: Partial<Record<SignalType, number>> = {};
  for (const [type, answer] of Object.entries(result.answers)) {
    if (answer.type === 'boolean') probabilities[type as SignalType] = answer.probability;
  }
  return { model: JEV_MODEL, probabilities };
}
