import { getRedis } from './redis';

// Short-link store. Mirrors the execution-store key contract (a hash per record
// plus a sorted-set index), sharing the SAME Upstash instance. The landing-page
// admin dashboard writes links here and the public `/s/[code]` redirect route
// reads them, so this module is the single source of truth for the schema.
const RECORD_PREFIX = 'shortlink:';
const INDEX_KEY = 'shortlinks';

// Unambiguous base62 alphabet for auto-generated codes.
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 6;
const MAX_GENERATION_ATTEMPTS = 5;

// Custom aliases: letters, digits, dash, underscore.
const ALIAS_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export interface ShortLink {
  code: string;
  url: string;
  label: string;
  createdAt: number;
  createdBy: string;
  clicks: number;
}

export interface CreateShortLinkInput {
  url: string;
  createdBy: string;
  label?: string;
  alias?: string;
}

export class ShortLinkError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'ShortLinkError';
  }
}

export function isValidAlias(alias: string): boolean {
  return ALIAS_PATTERN.test(alias);
}

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export async function codeExists(code: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  return (await redis.exists(`${RECORD_PREFIX}${code}`)) === 1;
}

export async function getShortLink(code: string): Promise<ShortLink | null> {
  const redis = getRedis();
  if (!redis) return null;

  const record = await redis.hgetall(`${RECORD_PREFIX}${code}`);
  if (!record || Object.keys(record).length === 0) return null;

  return record as unknown as ShortLink;
}

export async function createShortLink(input: CreateShortLinkInput): Promise<ShortLink> {
  const redis = getRedis();
  if (!redis) throw new ShortLinkError('storage_unavailable');

  let code: string;
  if (input.alias) {
    if (!isValidAlias(input.alias)) throw new ShortLinkError('invalid_alias');
    if (await codeExists(input.alias)) throw new ShortLinkError('alias_taken');
    code = input.alias;
  } else {
    code = generateCode();
    let attempts = 0;
    while (await codeExists(code)) {
      if (++attempts >= MAX_GENERATION_ATTEMPTS) {
        throw new ShortLinkError('code_generation_failed');
      }
      code = generateCode();
    }
  }

  const record: ShortLink = {
    code,
    url: input.url,
    label: input.label?.trim() || '',
    createdAt: Date.now(),
    createdBy: input.createdBy,
    clicks: 0,
  };

  const pipeline = redis.pipeline();
  pipeline.hset(`${RECORD_PREFIX}${code}`, record);
  pipeline.zadd(INDEX_KEY, { score: record.createdAt, member: code });
  await pipeline.exec();

  return record;
}

export async function listShortLinks(
  limit = 50,
  offset = 0
): Promise<{ links: ShortLink[]; total: number }> {
  const redis = getRedis();
  if (!redis) return { links: [], total: 0 };

  const total = await redis.zcard(INDEX_KEY);
  if (total === 0) return { links: [], total: 0 };

  const codes = await redis.zrange(INDEX_KEY, offset, offset + limit - 1, { rev: true });
  if (codes.length === 0) return { links: [], total };

  const pipeline = redis.pipeline();
  for (const code of codes) {
    pipeline.hgetall(`${RECORD_PREFIX}${code}`);
  }

  const results = await pipeline.exec();
  const links = results.filter(Boolean) as ShortLink[];

  return { links, total };
}

// Fire-and-forget from the redirect route; failures are non-fatal.
export async function incrementClickCount(code: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hincrby(`${RECORD_PREFIX}${code}`, 'clicks', 1);
}

// Rename/retag: update only the human-readable label. The code (and therefore any
// already-shared /s/<code> link) is left untouched. Returns the updated record,
// or null if storage is unavailable or the code doesn't exist.
export async function updateShortLinkLabel(
  code: string,
  label: string
): Promise<ShortLink | null> {
  const redis = getRedis();
  if (!redis) return null;
  if (!(await codeExists(code))) return null;

  await redis.hset(`${RECORD_PREFIX}${code}`, { label: label.trim() });
  return getShortLink(code);
}

// Remove a short link entirely. After this the /s/<code> route 404s (redirects
// home). Drops both the record hash and the index entry.
export async function deleteShortLink(code: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const pipeline = redis.pipeline();
  pipeline.del(`${RECORD_PREFIX}${code}`);
  pipeline.zrem(INDEX_KEY, code);
  await pipeline.exec();
}
