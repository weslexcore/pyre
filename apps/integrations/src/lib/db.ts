import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client for durable engine state (journey enrollments,
// the email send log, and the suppression list — see the email_marketing
// migration in apps/supabase). Server-side only: the service-role key bypasses
// RLS and must never reach a client bundle.
//
// Like getRedis()/getResend(), returns null when unconfigured so callers can
// degrade gracefully instead of crashing the webhook path.

export interface JourneyEnrollmentRow {
  id: string;
  journey_id: string;
  member_id: number;
  email: string;
  step: number;
  next_at: string | null;
  status: 'active' | 'completed' | 'exited';
  exit_reason: string | null;
  enrolled_at: string;
  updated_at: string;
}

export interface EmailSendRow {
  id: string;
  email: string;
  member_id: number | null;
  template: string;
  kind: 'transactional' | 'marketing';
  journey_id: string | null;
  step_id: string | null;
  campaign: string | null;
  send_key: string | null;
  resend_id: string | null;
  status: 'sent' | 'skipped' | 'suppressed' | 'failed';
  error: string | null;
  sent_at: string;
}

export interface EmailSuppressionRow {
  id: string;
  email: string;
  reason: 'unsubscribe' | 'complaint' | 'bounce' | 'momence' | 'manual';
  source: string | null;
  created_at: string;
}

let client: SupabaseClient | null | undefined;

export function getDb(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = import.meta.env.SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.warn('[DB] Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    client = null;
    return client;
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
