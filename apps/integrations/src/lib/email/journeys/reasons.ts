import { CONDITIONS, type ConditionType } from './schema';

// The engine's reason codes (journey_step_events.detail, exit_reason, step
// outcomes) in words, for the People tab. Pure — shared by the route and the
// island.

function conditionWords(code: string): string {
  const negated = code.startsWith('not-');
  const type = (negated ? code.slice(4) : code) as ConditionType;
  const meta = CONDITIONS[type];
  if (!meta) return code.replace(/-/g, ' ');
  return (negated ? meta.negatedLabel : meta.label).toLowerCase();
}

const FIXED: Record<string, string> = {
  stale: 'too late - more than a day past its time',
  'no-expiry-date': 'no expiry date to time it from',
  'actions-only': 'ran its tag actions (no email)',
  'not-yet-due': 'not due yet',
  'frequency-cap': 'they already got a marketing email recently',
  'not-whitelisted': 'not on the test whitelist',
  unsubscribed: 'unsubscribed',
  'journey-retired': 'the journey was retired',
  'skipped:already-sent': 'already sent to them earlier in this run',
  'suppressed:template-not-live':
    'not delivered - the email template is not live and they are not whitelisted',
  'suppressed:unsubscribed': 'unsubscribed',
  'skipped:resend-not-configured': 'not delivered - email sending is not configured',
  'skipped:send-log-unavailable': 'not delivered - the send log was unavailable',
  'skipped:unsubscribe-url-unavailable': 'not delivered - no unsubscribe link could be made',
};

/** "skip:not-attended-trigger-session" -> "did not check in to the session". */
export function describeReason(code: string | null): string {
  if (!code) return '';
  if (FIXED[code]) return FIXED[code];
  if (code.startsWith('skip:')) return conditionWords(code.slice(5));
  if (code.startsWith('exit:')) return conditionWords(code.slice(5));
  if (code.startsWith('missing-merge-field:')) {
    return `no value for ${code
      .slice('missing-merge-field:'.length)
      .split(',')
      .map((f) => `{{${f}}}`)
      .join(', ')}`;
  }
  if (code.startsWith('removed-by:')) return `removed by ${code.slice('removed-by:'.length)}`;
  if (code.startsWith('restarted-by:')) return `restarted by ${code.slice('restarted-by:'.length)}`;
  if (code.startsWith('by:')) return `by ${code.slice(3)}`;
  if (code.startsWith('manual:')) return `added by ${code.slice('manual:'.length)}`;
  if (code === 'manual') return 'added by hand';
  // Deferrals carry the new time after the reason: "frequency-cap:2026-...".
  const deferred = code.match(/^(not-yet-due|frequency-cap):(.+)$/);
  if (deferred) return FIXED[deferred[1]];
  return code.replace(/-/g, ' ');
}
