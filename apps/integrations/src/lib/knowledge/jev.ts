// The one place that knows TypeSafe's wire format for Jev, their "System
// One" model: POST a state (text or JSON) and a map of named, typed
// questions to /v1/systemone and get back one typed answer per question.
// lib/knowledge/route.ts declares the Ask box's questions and decides what
// to do with the answers; this file only translates to and from HTTP.
//
// ─── ASSUMED SHAPE ──────────────────────────────────────────────────────────
// TypeSafe's docs (docs.typesafe.ai) were not reachable when this was
// written, so the shape below is pieced together from third-party write-ups
// and is NOT verified against the API reference. What those sources agree on:
//   - POST https://api.typesafe.ai/v1/systemone, `Authorization: Bearer <key>`
//   - request  { model, state, questions: { [name]: question } }
//   - response { model, answers: { [name]: answer }, usage }
//   - question types `choice`, `score`, and `noul` (their boolean): a
//     choice is declared with `instructions` plus `criteria` (option → what
//     it means) and answers `{ choice, probabilities, confidence }`; a noul
//     answers `{ noul }`, a single probability that the statement is true,
//     with no separate confidence.
// Still assumed: how a noul is declared (`instructions` only), and that each
// answer sits directly under its question's name in `answers`. If a real
// response disagrees, fix `toRequestBody` / `parseAnswers` here — nothing
// else depends on the wire format. The parser rejects anything it does not
// recognise, which the caller treats as "no routing" (fail open).
// ────────────────────────────────────────────────────────────────────────────

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

export type JevAnswer =
  | { type: 'noul'; probability: number }
  | { type: 'choice'; choice: string; confidence: number };

/** The request body for a set of named questions about one piece of state. */
export function toRequestBody(state: string, questions: Record<string, JevQuestion>): string {
  return JSON.stringify({ model: JEV_MODEL, state, questions });
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Read the answers for `questions` out of a response body. Null when any
 * declared question is missing or malformed, or a choice falls outside the
 * options declared for it — a partial answer is not worth routing on.
 */
export function parseAnswers(
  body: unknown,
  questions: Record<string, JevQuestion>
): Record<string, JevAnswer> | null {
  if (!body || typeof body !== 'object') return null;
  const answers = (body as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object') return null;

  const parsed: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    const raw = (answers as Record<string, unknown>)[name];
    if (!raw || typeof raw !== 'object') return null;
    const answer = raw as Record<string, unknown>;
    if (question.type === 'noul') {
      if (!isUnitInterval(answer.noul)) return null;
      parsed[name] = { type: 'noul', probability: answer.noul };
    } else {
      if (typeof answer.choice !== 'string' || !(answer.choice in question.criteria)) return null;
      if (!isUnitInterval(answer.confidence)) return null;
      parsed[name] = { type: 'choice', choice: answer.choice, confidence: answer.confidence };
    }
  }
  return parsed;
}

/**
 * Ask Jev the questions. Throws on a network error, an abort, or a non-2xx
 * status; resolves null on a body it cannot read.
 */
export async function askJev(
  apiKey: string,
  state: string,
  questions: Record<string, JevQuestion>,
  signal: AbortSignal
): Promise<Record<string, JevAnswer> | null> {
  const res = await fetch(JEV_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: toRequestBody(state, questions),
    signal,
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
  return parseAnswers(await res.json(), questions);
}
