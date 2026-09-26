// Where the pyre-agents Eve app is and how to reach it, for every route that
// opens a session there (the Ask box, the schedule drafter, suggestions).
// Null when the agents app is not configured, which turns those features off.

import type { EveConfig } from '@/lib/schedule/eve-session';

export function agentsEveConfig(headers?: Record<string, string>): EveConfig | null {
  const baseUrl = import.meta.env.AGENTS_BASE_URL;
  const channelSecret = import.meta.env.EVE_CHANNEL_SECRET;
  if (!baseUrl || !channelSecret) return null;
  return {
    baseUrl,
    channelSecret,
    bypassSecret: import.meta.env.AGENTS_PROTECTION_BYPASS,
    ...(headers ? { headers } : {}),
  };
}
