import { recordExecution, type WebhookExecution, WebhookTracer } from '@pyre/webhook-core';
import type { APIContext, APIRoute } from 'astro';

export type TracedAPIRoute = (context: APIContext, tracer: WebhookTracer) => Promise<Response>;

export function instrumentWebhook(source: string, handler: TracedAPIRoute): APIRoute {
  const instrumented: APIRoute = async (context) => {
    const start = Date.now();
    const id = `${source}-${start}-${Math.random().toString(36).slice(2, 8)}`;
    const tracer = new WebhookTracer();

    // Clone request so inner handler can still read the body
    const clone = context.request.clone();

    let eventType = 'unknown';
    let payloadSummary = '{}';
    let fullPayload = '{}';
    // Capture relevant request headers
    const headerKeys = [
      'x-webhook-secret',
      'x-webhook-signature',
      'x-webhook-reqeuest-id',
      'content-type',
      'user-agent',
      'x-forwarded-for',
      'x-vercel-id',
      'authorization',
    ];
    const headers: Record<string, string> = {};
    for (const key of headerKeys) {
      const val = context.request.headers.get(key);
      if (val) {
        if (
          key === 'x-webhook-secret' ||
          key === 'x-webhook-signature' ||
          key === 'authorization'
        ) {
          headers[key] = val.length > 12 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '***';
        } else {
          headers[key] = val;
        }
      }
    }
    const requestHeaders = JSON.stringify(headers);

    // Try to extract metadata from the cloned request
    try {
      const body = await clone.json();
      if (body.payload && typeof body.payload === 'string') {
        const parsed = JSON.parse(body.payload);
        eventType = parsed.event ?? 'unknown';
        fullPayload = JSON.stringify(parsed).slice(0, 10_000);
        const summary: Record<string, string> = {};
        if (parsed.payload?.email) summary.email = parsed.payload.email;
        if (parsed.payload?.memberId) summary.memberId = parsed.payload.memberId;
        if (parsed.payload?.sessionId) summary.sessionId = String(parsed.payload.sessionId);
        payloadSummary = JSON.stringify(summary);
      }
    } catch {
      // Body parsing failed — continue with defaults
    }

    let response: Response;
    let status: 'success' | 'error' = 'success';
    let errorMessage = '';

    try {
      response = await handler(context, tracer);
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
      source,
      status,
      durationMs: Date.now() - start,
      payloadSummary,
      fullPayload,
      requestHeaders,
      traceSteps: tracer.toJSON(),
      errorMessage,
      httpStatus: response.status,
    };

    try {
      await recordExecution(record);
    } catch (err) {
      console.error('[Instrument] Failed to record execution:', err);
    }

    return response;
  };

  return instrumented;
}
