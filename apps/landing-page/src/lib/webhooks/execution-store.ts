import { getRedis } from './redis';

const SORTED_SET_KEY = 'webhook:executions';
const RECORD_PREFIX = 'webhook:exec:';
const TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

export interface WebhookExecution {
  id: string;
  timestamp: number;
  eventType: string;
  requestId: string;
  source: string;
  status: 'success' | 'error';
  durationMs: number;
  payloadSummary: string; // JSON: { email?, memberId? }
  fullPayload: string; // Full parsed webhook payload as JSON
  requestHeaders: string; // Relevant request headers as JSON
  traceSteps: string; // JSON array of TraceStep
  errorMessage: string;
  httpStatus: number;
}

export async function recordExecution(record: WebhookExecution): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const key = `${RECORD_PREFIX}${record.id}`;
  const cutoff = Date.now() - TTL_SECONDS * 1000;

  const pipeline = redis.pipeline();
  pipeline.hset(key, record);
  pipeline.expire(key, TTL_SECONDS);
  pipeline.zadd(SORTED_SET_KEY, { score: record.timestamp, member: record.id });
  pipeline.zremrangebyscore(SORTED_SET_KEY, 0, cutoff);

  await pipeline.exec();
}

export async function getRecentExecutions(
  limit = 50,
  offset = 0
): Promise<{ records: WebhookExecution[]; total: number }> {
  const redis = getRedis();
  if (!redis) return { records: [], total: 0 };

  const total = await redis.zcard(SORTED_SET_KEY);
  if (total === 0) return { records: [], total: 0 };

  const ids = await redis.zrange(SORTED_SET_KEY, offset, offset + limit - 1, { rev: true });
  if (ids.length === 0) return { records: [], total };

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.hgetall(`${RECORD_PREFIX}${id}`);
  }

  const results = await pipeline.exec();
  const records = results.filter(Boolean) as WebhookExecution[];

  return { records, total };
}

export async function getExecution(id: string): Promise<WebhookExecution | null> {
  const redis = getRedis();
  if (!redis) return null;

  const record = await redis.hgetall(`${RECORD_PREFIX}${id}`);
  if (!record || Object.keys(record).length === 0) return null;

  return record as unknown as WebhookExecution;
}
