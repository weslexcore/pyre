import { PostHog } from 'posthog-node';

let client: PostHog | null = null;

// Lazy singleton — mirrors getResend(). Returns null when unconfigured so callers
// can no-op gracefully (e.g. in local/dev without a PostHog key).
//
// flushAt/flushInterval are tuned for serverless: capture sends immediately and
// callers await `captureEvent` (which flushes) so events aren't lost when the
// function freezes after responding.
export function getPostHog(): PostHog | null {
  if (client) return client;

  // process.env fallback: import.meta.env is inlined at build time, so a value
  // added to Vercel after the cached build was compiled only exists at runtime.
  const apiKey = import.meta.env.POSTHOG_API_KEY ?? process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.warn('[PostHog] POSTHOG_API_KEY not configured');
    return null;
  }

  client = new PostHog(apiKey, {
    host: import.meta.env.POSTHOG_HOST || process.env.POSTHOG_HOST || 'https://us.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

interface CaptureParams {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  /** When the event really happened, for captures that trail the fact (a
   * backfill, a webhook that arrives after the sale). Defaults to now. */
  timestamp?: Date;
}

/**
 * Capture a server-side event and flush before returning. Best-effort: any
 * failure is swallowed so analytics can never break a webhook's critical path.
 * Resolves true only when the event was handed to PostHog and flushed, so a
 * caller with its own idempotency marker can decide whether to set it.
 */
export async function captureEvent({
  distinctId,
  event,
  properties,
  timestamp,
}: CaptureParams): Promise<boolean> {
  const posthog = getPostHog();
  if (!posthog) return false;

  try {
    posthog.capture({ distinctId, event, properties, ...(timestamp && { timestamp }) });
    await posthog.flush();
    return true;
  } catch (error) {
    console.warn(`[PostHog] failed to capture ${event}`, error);
    return false;
  }
}
