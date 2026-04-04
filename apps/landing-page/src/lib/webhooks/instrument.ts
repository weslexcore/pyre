import type { APIRoute } from 'astro';
import { recordExecution, type WebhookExecution } from './execution-store';

export function instrumentWebhook(source: string, handler: APIRoute): APIRoute {
  const instrumented: APIRoute = async (context) => {
    const start = Date.now();
    const id = `${source}-${start}-${Math.random().toString(36).slice(2, 8)}`;

    // Clone request so inner handler can still read the body
    const clone = context.request.clone();

    let eventType = 'unknown';
    let payloadSummary = '{}';
    const requestId = context.request.headers.get('x-webhook-reqeuest-id') ?? 'unknown';

    // Try to extract metadata from the cloned request
    try {
      const body = await clone.json();
      if (body.payload && typeof body.payload === 'string') {
        const parsed = JSON.parse(body.payload);
        eventType = parsed.event ?? 'unknown';
        const summary: Record<string, string> = {};
        if (parsed.payload?.email) summary.email = parsed.payload.email;
        if (parsed.payload?.memberId) summary.memberId = parsed.payload.memberId;
        payloadSummary = JSON.stringify(summary);
      }
    } catch {
      // Body parsing failed — continue with defaults
    }

    let response: Response;
    let status: 'success' | 'error' = 'success';
    let errorMessage = '';

    try {
      response = await handler(context);
      if (response.status >= 400) {
        status = 'error';
        try {
          const errBody = await response.clone().json();
          errorMessage = (errBody.error ?? '').slice(0, 500);
        } catch {
          errorMessage = `HTTP ${response.status}`;
        }
      }
    } catch (err) {
      status = 'error';
      errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      response = new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const record: WebhookExecution = {
      id,
      timestamp: start,
      eventType,
      requestId,
      source,
      status,
      durationMs: Date.now() - start,
      payloadSummary,
      errorMessage,
      httpStatus: response.status,
    };

    // Await to avoid data loss on serverless; silently catch Redis errors
    try {
      await recordExecution(record);
    } catch (err) {
      console.error('[Instrument] Failed to record execution:', err);
    }

    return response;
  };

  return instrumented;
}
