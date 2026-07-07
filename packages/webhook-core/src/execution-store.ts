import { getRedis } from './redis';
import { appendDailyStats } from './webhook-stats';

const SORTED_SET_KEY = 'webhook:executions';
const RECORD_PREFIX = 'webhook:exec:';
const TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

export interface WebhookExecution {
  id: string;
  timestamp: number;
  eventType: string;
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
  appendDailyStats(pipeline, record);

  await pipeline.exec();
}

/** Slim execution record without the heavy payload/trace fields, for stats. */
export interface WebhookExecutionSummary {
  id: string;
  timestamp: number;
  eventType: string;
  source: string;
  status: 'success' | 'error';
  durationMs: number;
  errorMessage: string;
  httpStatus: number;
}

const SUMMARY_FIELDS = [
  'id',
  'timestamp',
  'eventType',
  'source',
  'status',
  'durationMs',
  'errorMessage',
  'httpStatus',
] as const;

/**
 * Executions since `sinceMs`, newest first, fetching only summary fields so the
 * pipeline stays light even when payloads are large. Capped at `limit` (the
 * newest records win when truncating).
 */
export async function getExecutionSummariesSince(
  sinceMs: number,
  limit = 1000
): Promise<WebhookExecutionSummary[]> {
  const redis = getRedis();
  if (!redis) return [];

  const ids = await redis.zrange<string[]>(SORTED_SET_KEY, '+inf', sinceMs, {
    byScore: true,
    rev: true,
    offset: 0,
    count: limit,
  });
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.hmget(`${RECORD_PREFIX}${id}`, ...SUMMARY_FIELDS);
  }

  const results = await pipeline.exec<Array<Record<string, unknown> | null>>();
  return results
    .filter((r): r is Record<string, unknown> => Boolean(r?.id))
    .map((r) => ({
      id: String(r.id),
      timestamp: Number(r.timestamp) || 0,
      eventType: String(r.eventType ?? ''),
      source: String(r.source ?? ''),
      status: r.status === 'error' ? 'error' : 'success',
      durationMs: Number(r.durationMs) || 0,
      errorMessage: String(r.errorMessage ?? ''),
      httpStatus: Number(r.httpStatus) || 0,
    }));
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
