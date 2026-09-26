// "Email each of these people" — the staff alerts (incident filed, item
// claimed, sub requested or covered). Best-effort per recipient: one bad
// address must not stop the rest, and a total outage must not fail the
// action that triggered the alert, which is already saved by the time this
// runs.

import type { EmailTemplateKey } from '@/emails/types';
import { type SendTemplateArgs, sendTemplate } from './send';

export interface EachSendResult {
  to: string;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
}

/**
 * Send one message per recipient, in order. `build` gives each recipient's
 * arguments (`to` is filled in). Failures are logged under `scope` and
 * reported as 'failed'; nothing throws.
 */
export async function sendToEach<K extends EmailTemplateKey>(
  recipients: readonly string[],
  build: (to: string) => Omit<SendTemplateArgs<K>, 'to'>,
  scope: string
): Promise<EachSendResult[]> {
  const results: EachSendResult[] = [];
  for (const to of recipients) {
    try {
      const result = await sendTemplate({ ...build(to), to } as SendTemplateArgs<K>);
      results.push(
        result.status === 'sent'
          ? { to, status: 'sent' }
          : { to, status: 'skipped', reason: result.reason }
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[${scope}] send to ${to} failed:`, reason);
      results.push({ to, status: 'failed', reason });
    }
  }
  return results;
}

/** The recipients a send actually reached. */
export function deliveredTo(results: readonly EachSendResult[]): string[] {
  return results.filter((r) => r.status === 'sent').map((r) => r.to);
}
