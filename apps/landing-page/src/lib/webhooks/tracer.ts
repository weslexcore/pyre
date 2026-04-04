export interface TraceStep {
  name: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

export class WebhookTracer {
  private steps: TraceStep[] = [];

  async span<T>(name: string, fn: () => Promise<T>, input?: Record<string, unknown>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.steps.push({
        name,
        startMs: start,
        durationMs: Date.now() - start,
        status: 'ok',
        input,
        output: summarizeResult(result),
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.steps.push({
        name,
        startMs: start,
        durationMs: Date.now() - start,
        status: 'error',
        input,
        error: message.slice(0, 500),
      });
      throw err;
    }
  }

  getSteps(): TraceStep[] {
    return this.steps;
  }

  toJSON(): string {
    return JSON.stringify(this.steps);
  }
}

function summarizeResult(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object') return { value };
  // For known shapes, extract key fields
  const obj = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (obj.email) summary.email = obj.email;
  if (obj.firstName) summary.firstName = obj.firstName;
  if (obj.lastName) summary.lastName = obj.lastName;
  if (obj.phone) summary.phone = obj.phone;
  if (obj.tags) summary.tags = obj.tags;
  if (obj.totalCount) summary.totalCount = obj.totalCount;
  if (obj.members && Array.isArray(obj.members)) summary.memberCount = obj.members.length;
  if (Object.keys(summary).length === 0) return undefined;
  return summary;
}
