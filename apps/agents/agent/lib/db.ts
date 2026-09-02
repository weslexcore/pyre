// Supabase client for agent tools — READ ONLY by convention, with one
// exception: the knowledge assistant appends to its own audit log
// (knowledge_queries, see lib/knowledge/audit.ts). This app holds
// its own revocable secret key (SUPABASE_AGENTS_SECRET_KEY); all schedule
// writes go through the integrations app's /api/agent/proposals endpoint so
// validation and state transitions stay single-sourced.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

export function getDb(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_AGENTS_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('Supabase not configured (SUPABASE_URL / SUPABASE_AGENTS_SECRET_KEY)');
  }

  client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
