// Pre-routing for the staff "Ask" box. Before a fresh question opens a full
// knowledge session (Opus, a search/read/cite loop — seconds, with a guest
// often waiting), Jev screens it in ~100ms: is it about running the sauna at
// all, and if so which part of the knowledge base is it likely about?
//
// Only a question Jev is very sure is off-topic is answered here, with a
// canned reply the asker can override ("Ask anyway" → force). A confident
// domain rides into the session as a hint; everything else — mixed,
// uncertain, or unrouted — goes to the agent exactly as before. Every
// failure (flag off, no key, timeout, bad response) is `null`, and `null`
// means "behave as if this file did not exist": the router fails open.
//
// The wire format lives in lib/knowledge/jev.ts.

import { captureEvent } from '@/lib/analytics/posthog';
import { askJev, type JevQuestion } from './jev';

export const ASK_DOMAINS = [
  'sop',
  'water',
  'incident',
  'schedule',
  'shift_notes',
  'off_topic',
] as const;
export type AskDomain = (typeof ASK_DOMAINS)[number];

export interface AskRoute {
  inScope: boolean;
  /** Confidence in `inScope` itself, 0.5–1, whichever way it went. */
  inScopeConfidence: number;
  domain: AskDomain;
  domainConfidence: number;
  latencyMs: number;
}

/** Jev answers in ~100ms; past this the asker is better off with the agent. */
export const ROUTE_TIMEOUT_MS = 800;

/** How sure Jev must be that a question is out of scope before we answer it ourselves. */
export const OFF_TOPIC_THRESHOLD = 0.9;

/** How sure Jev must be of a domain before the agent hears about it. */
export const HINT_THRESHOLD = 0.7;

/** How each domain reads in the "Likely topic" hint line. */
const DOMAIN_HINTS: Record<Exclude<AskDomain, 'off_topic'>, string> = {
  sop: 'SOPs',
  water: 'water log',
  incident: 'incident reports',
  schedule: 'staff schedule',
  shift_notes: 'shift notes',
};

export const ASK_ROUTE_QUESTIONS: Record<'in_scope' | 'domain', JevQuestion> = {
  in_scope: {
    type: 'noul',
    instructions:
      'Is this a question about operating Pyre Sauna: procedures, safety, water chemistry, ' +
      'incidents, staff schedule, shift handover?',
  },
  domain: {
    type: 'choice',
    instructions: 'Which part of the Pyre Sauna staff knowledge base is this question about?',
    criteria: {
      sop: 'Standard operating procedures: opening, closing, cleaning, guest safety, how we run sessions',
      water:
        'The water log and water chemistry: plunge and tub tests, sanitiser, shocking, temperatures',
      incident: 'Incident reports: injuries, guest complaints, damage, anything that went wrong',
      schedule: 'The staff schedule: shifts, who is working, hours',
      shift_notes: 'Shift notes and handover between shifts',
      off_topic: 'Not about operating Pyre Sauna at all',
    },
  },
};

function readEnv(name: 'TYPESAFE_API_KEY' | 'ASK_ROUTER_ENABLED'): string | undefined {
  // process.env fallback: vars added after the cached build only exist at runtime.
  return import.meta.env[name] ?? process.env[name];
}

/** Whether the router should run at all: the flag is on and there is a key. */
export function isAskRouterEnabled(): boolean {
  const flag = readEnv('ASK_ROUTER_ENABLED')?.trim().toLowerCase();
  return (flag === 'true' || flag === '1') && Boolean(readEnv('TYPESAFE_API_KEY'));
}

/**
 * Screen a staff question with Jev. Null — "don't route" — when the router is
 * off or unconfigured, Jev errors or takes longer than ROUTE_TIMEOUT_MS, or
 * the answer can't be read. Never throws.
 */
export async function classifyAskQuestion(
  question: string,
  { timeoutMs = ROUTE_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<AskRoute | null> {
  if (!isAskRouterEnabled()) return null;
  const apiKey = readEnv('TYPESAFE_API_KEY') as string;

  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const answers = await askJev(apiKey, question, ASK_ROUTE_QUESTIONS, abort.signal);
    const inScope = answers?.in_scope;
    const domain = answers?.domain;
    if (inScope?.type !== 'noul' || domain?.type !== 'choice') return null;
    return {
      inScope: inScope.probability >= 0.5,
      inScopeConfidence: Math.max(inScope.probability, 1 - inScope.probability),
      domain: domain.choice as AskDomain,
      domainConfidence: domain.confidence,
      latencyMs: Date.now() - started,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type AskRouteDecision = 'short_circuit' | 'passthrough' | { hint: string };

/**
 * What the ask route does with a classification. Short-circuits only when
 * both answers agree the question is off-topic and the scope answer is very
 * sure; hints only on a confident, real domain; passes everything else.
 */
export function decideAskRoute(
  route: AskRoute | null,
  { force = false }: { force?: boolean } = {}
): AskRouteDecision {
  if (force || !route) return 'passthrough';
  if (
    !route.inScope &&
    route.inScopeConfidence >= OFF_TOPIC_THRESHOLD &&
    route.domain === 'off_topic'
  ) {
    return 'short_circuit';
  }
  if (route.domain !== 'off_topic' && route.domainConfidence >= HINT_THRESHOLD) {
    return { hint: DOMAIN_HINTS[route.domain] };
  }
  return 'passthrough';
}

/**
 * Record one routing decision — never the question itself — so the
 * thresholds can be tuned against real traffic. PostHog when configured,
 * a structured log line otherwise. Best-effort; never throws.
 */
export async function logAskRoute(
  email: string,
  route: AskRoute | null,
  decision: AskRouteDecision,
  { forced }: { forced: boolean }
): Promise<void> {
  const properties = {
    decision: typeof decision === 'string' ? decision : 'hint',
    hint: typeof decision === 'string' ? null : decision.hint,
    forced,
    classified: route !== null,
    in_scope: route?.inScope ?? null,
    in_scope_confidence: route?.inScopeConfidence ?? null,
    domain: route?.domain ?? null,
    domain_confidence: route?.domainConfidence ?? null,
    latency_ms: route?.latencyMs ?? null,
  };
  try {
    const captured = await captureEvent({
      distinctId: email,
      event: 'knowledge_ask_routed',
      properties,
    });
    if (!captured) console.info('[knowledge-ask] route', JSON.stringify(properties));
  } catch {
    // Analytics never gets in the way of an answer.
  }
}
