// Jev, TypeSafe AI's System One evaluation model, for any Pyre app or agent.
// Jev answers typed questions (boolean, choice, score) about a state you hand
// it instead of writing prose, which suits classification and triage: fast,
// cheap, and it can only answer with the options it was given.
//
// Jev is an AI Gateway model, so the AI SDK's evaluation API reaches it
// directly from whichever app needs it: no agent session, no service hop.
// Credentials are the Gateway's usual ones: Vercel OIDC when deployed, an
// AI_GATEWAY_API_KEY locally. An app whose env loader does not populate
// process.env (Astro's import.meta.env) passes the key as `apiKey`.

import {
  createGateway,
  experimental_evaluate as evaluate,
  type Experimental_EvaluationModel as EvaluationModel,
  type Experimental_EvaluationQuestion as EvaluationQuestion,
  type Experimental_EvaluationResult as EvaluationResult,
} from 'ai';

export type { EvaluationModel, EvaluationQuestion, EvaluationResult };

/** What Jev reads: text or structured JSON describing the thing being judged. */
export type JevState = Parameters<typeof evaluate>[0]['state'];

/** Jev through AI Gateway. */
export const JEV_MODEL = 'typesafe-ai/jev';

/** Jev answers in well under a second; this only bounds a stuck upstream. */
export const JEV_TIMEOUT_MS = 20_000;

export interface JevOptions {
  /** A model instance to use instead of Jev (tests pass ai/test's mock). */
  model?: EvaluationModel;
  /** AI Gateway API key; omitted, the AI SDK reads AI_GATEWAY_API_KEY or uses Vercel OIDC. */
  apiKey?: string;
  /** Defaults to a JEV_TIMEOUT_MS timeout. */
  abortSignal?: AbortSignal;
}

/**
 * Whether Jev can be reached from here: a Gateway key, or a Vercel
 * deployment (OIDC). Callers use it to switch a Jev-backed feature off
 * cleanly instead of failing every call.
 */
export function jevAvailable(apiKey?: string | null): boolean {
  return Boolean(apiKey || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
}

/**
 * Put `questions` to Jev about `state`. Answers come back keyed like the
 * questions: `{ type: 'boolean', probability }` for a boolean, the chosen key
 * for a choice, a number for a score. Throws when Gateway or Jev fails.
 */
export function askJev<const QUESTIONS extends Record<string, EvaluationQuestion>>(
  state: JevState,
  questions: QUESTIONS,
  options: JevOptions = {}
): Promise<EvaluationResult<QUESTIONS>> {
  const model =
    options.model ??
    (options.apiKey ? createGateway({ apiKey: options.apiKey }).evaluationModel(JEV_MODEL) : JEV_MODEL);
  return evaluate({
    model,
    state,
    questions,
    abortSignal: options.abortSignal ?? AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
}

/**
 * The common case: yes/no questions, answered as P(true) keyed by question.
 * Throws when any question comes back without a boolean answer.
 */
export async function askJevBooleans<K extends string>(
  state: JevState,
  questions: Record<K, EvaluationQuestion & { type: 'boolean' }>,
  options: JevOptions = {}
): Promise<Record<K, number>> {
  const { answers } = await askJev(state, questions as Record<string, EvaluationQuestion>, options);
  const probabilities = {} as Record<K, number>;
  for (const key of Object.keys(questions) as K[]) {
    const answer = (answers as Record<string, { type?: string; probability?: unknown }>)[key];
    if (answer?.type !== 'boolean' || typeof answer.probability !== 'number') {
      throw new Error(`Jev left "${key}" unanswered`);
    }
    probabilities[key] = answer.probability;
  }
  return probabilities;
}
