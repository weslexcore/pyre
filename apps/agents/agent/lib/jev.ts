// A minimal client for Jev, TypeSafe AI's System One evaluation model, through
// Vercel AI Gateway. Jev answers typed questions (choice, score, boolean)
// about a state you hand it, instead of writing prose, which suits
// classification: fast, cheap, and it can only answer with the options it
// was given.
//
// Newer eve (`evaluate` from eve/ai) and AI SDK (`experimental_evaluate`)
// versions wrap exactly this call, but both shipped after this repo's pinned
// versions and inside the 14-day npm age gate (.yarnrc.yml), so for now this
// speaks the Gateway's evaluation protocol directly — the same request
// @ai-sdk/gateway's GatewayEvaluationModel makes, with the same credentials
// the agent's language models use (AI_GATEWAY_API_KEY locally, Vercel OIDC
// when deployed). Once the pins move past eve 0.66 / ai 7.0.105, swap the
// body of `evaluate` for `evaluate` from eve/ai and keep the call sites.

import { getVercelOidcToken } from '@vercel/oidc';

export const JEV_MODEL = 'typesafe-ai/jev';

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model';
const GATEWAY_PROTOCOL_VERSION = '0.0.1';
const EVALUATION_SPEC_VERSION = '4';

/** A description Jev reads: text or structured JSON. */
type Description = string | Record<string, unknown> | unknown[];

export interface BooleanQuestion {
  type: 'boolean';
  instructions: Description;
  criteria?: { true?: Description; false?: Description };
}

export interface BooleanAnswer {
  type: 'boolean';
  /** Model-estimated probability that the answer is true. */
  probability: number;
}

export interface EvaluationResult<K extends string> {
  answers: Record<K, BooleanAnswer>;
  usage?: { inputTokens?: number; outputTokens?: number };
}

async function gatewayAuth(): Promise<{ token: string; method: 'api-key' | 'oidc' }> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (apiKey) return { token: apiKey, method: 'api-key' };
  return { token: await getVercelOidcToken(), method: 'oidc' };
}

function isBooleanAnswer(value: unknown): value is BooleanAnswer {
  const v = value as { type?: unknown; probability?: unknown } | null;
  return (
    v?.type === 'boolean' &&
    typeof v.probability === 'number' &&
    Number.isFinite(v.probability) &&
    v.probability >= 0 &&
    v.probability <= 1
  );
}

/**
 * Ask Jev boolean questions about one state. Every question gets an answer
 * or the call throws — there is no partial result.
 */
export async function evaluate<K extends string>(options: {
  state: string | Record<string, unknown>;
  questions: Record<K, BooleanQuestion>;
  model?: string;
  abortSignal?: AbortSignal;
  /** Injected in tests. */
  fetch?: typeof fetch;
}): Promise<EvaluationResult<K>> {
  const { token, method } = await gatewayAuth();
  const response = await (options.fetch ?? fetch)(GATEWAY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'ai-gateway-protocol-version': GATEWAY_PROTOCOL_VERSION,
      'ai-gateway-auth-method': method,
      'ai-evaluation-model-specification-version': EVALUATION_SPEC_VERSION,
      'ai-model-id': options.model ?? JEV_MODEL,
    },
    body: JSON.stringify({ state: options.state, questions: options.questions }),
    signal: options.abortSignal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Jev evaluation failed (HTTP ${response.status}): ${detail}`);
  }
  const body = (await response.json()) as {
    answers?: Record<string, unknown>;
    usage?: EvaluationResult<K>['usage'];
  };
  const answers = {} as Record<K, BooleanAnswer>;
  for (const key of Object.keys(options.questions) as K[]) {
    const answer = body.answers?.[key];
    if (!isBooleanAnswer(answer)) throw new Error(`Jev returned no valid answer for "${key}"`);
    answers[key] = answer;
  }
  return { answers, ...(body.usage ? { usage: body.usage } : {}) };
}
