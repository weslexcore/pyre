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

  const apiKey = import.meta.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.warn('[PostHog] POSTHOG_API_KEY not configured');
    return null;
  }

  client = new PostHog(apiKey, {
    host: import.meta.env.POSTHOG_HOST || 'https://us.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

interface CaptureParams {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

/**
 * Capture a server-side event and flush before returning. Best-effort: any
 * failure is swallowed so analytics can never break a webhook's critical path.
 */
export async function captureEvent({
  distinctId,
  event,
  properties,
}: CaptureParams): Promise<void> {
  const posthog = getPostHog();
  if (!posthog) return;

  try {
    posthog.capture({ distinctId, event, properties });
    await posthog.flush();
  } catch (error) {
    console.warn(`[PostHog] failed to capture ${event}`, error);
  }
}
