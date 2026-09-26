// Reading and saving app settings (the app_settings table; definitions in
// ./registry). Server-only. Same shape as the schedule settings and the email
// gate: rows as the source of truth, a ~30s in-process cache, invalidated by
// the save route — so a change reaches every server instance within about
// that long, with no redeploy.
//
// A setting resolves to its saved value, else its environment variable,
// else its default. An unreachable database reads as "nothing saved" (the
// last good snapshot, when there is one), so a storage blip never flips a
// feature to something nobody chose.

import { getDb } from '@/lib/db';
import {
  parseEnvValue,
  parseSettingValue,
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
  type SettingValue,
  type SettingView,
} from './registry';

/**
 * The environment variable behind each setting that had one, read by name so
 * the bundler can see it (a computed import.meta.env[name] would be empty in
 * a production build).
 */
const ENV_READERS: Partial<Record<SettingKey, () => string | undefined>> = {
  'suggestions.auto': () => import.meta.env.SUGGESTIONS_AUTO,
};

interface Row {
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: string;
}

const CACHE_TTL_MS = 30_000;
let cache: { rows: Map<string, Row>; at: number } | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

async function loadRows(): Promise<Map<string, Row>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const db = getDb();
  if (!db) return cache?.rows ?? new Map();
  const { data, error } = await db
    .from('app_settings')
    .select('key, value, updated_by, updated_at');
  if (error) {
    console.error('[settings] fetch failed:', error.message);
    return cache?.rows ?? new Map();
  }
  const rows = new Map(((data ?? []) as Row[]).map((row) => [row.key, row]));
  cache = { rows, at: Date.now() };
  return rows;
}

function fallbackFor(key: SettingKey): { value: boolean | string[]; source: 'env' | 'default' } {
  const fromEnv = parseEnvValue(key, ENV_READERS[key]?.());
  if (fromEnv !== undefined) return { value: fromEnv, source: 'env' };
  const def: boolean | readonly string[] = SETTINGS[key].default;
  return { value: typeof def === 'boolean' ? def : [...def], source: 'default' };
}

function resolve(key: SettingKey, rows: Map<string, Row>): SettingView {
  const fallback = fallbackFor(key);
  const row = rows.get(key);
  // A saved value that no longer fits the definition (an option since
  // removed) is ignored rather than trusted.
  const saved = row ? parseSettingValue(key, row.value) : null;
  if (row && saved?.ok) {
    return {
      key,
      value: saved.value,
      source: 'saved',
      fallback: fallback.value,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }
  return {
    key,
    value: fallback.value,
    source: fallback.source,
    fallback: fallback.value,
    updatedBy: null,
    updatedAt: null,
  };
}

/** One setting's current value, typed by its definition. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return resolve(key, await loadRows()).value as SettingValue<K>;
}

/** Every setting, for the settings page. */
export async function getAllSettings(): Promise<SettingView[]> {
  const rows = await loadRows();
  return SETTING_KEYS.map((key) => resolve(key, rows));
}

/** Save a setting's value (already checked with parseSettingValue). */
export async function saveSetting(
  key: SettingKey,
  value: boolean | string[],
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };
  const { error } = await db
    .from('app_settings')
    .upsert({ key, value, updated_by: updatedBy }, { onConflict: 'key' });
  if (error) return { error: error.message };
  invalidateSettingsCache();
  return { error: null };
}

/** Forget the saved value: the setting goes back to its env var or default. */
export async function resetSetting(key: SettingKey): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };
  const { error } = await db.from('app_settings').delete().eq('key', key);
  if (error) return { error: error.message };
  invalidateSettingsCache();
  return { error: null };
}
