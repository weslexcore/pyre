import { createElement } from 'react';
import { EMAIL_TEMPLATES } from '@/emails/registry';
import type { EmailPropsByTemplate, EmailTemplateKey } from '@/emails/types';
import { isAllowedRecipient, isDevMode } from './dev-mode';
import { getResend } from './resend';
import { attachResendId, claimSend, recordSend, releaseSend } from './send-log';
import { isSuppressed } from './suppression';
import { buildUnsubscribeUrl } from './unsubscribe-token';

export type SendResult =
  | { status: 'sent'; id?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'suppressed'; reason: string };

export type EmailKind = 'transactional' | 'marketing';

interface SendTemplateArgs<K extends EmailTemplateKey> {
  to: string;
  template: K;
  props: EmailPropsByTemplate[K];
  /**
   * 'transactional' (default): booking confirmations etc. — always allowed.
   * 'marketing': journeys/campaigns — checked against the suppression list,
   * sent with List-Unsubscribe headers and an injected unsubscribeUrl prop.
   */
  kind?: EmailKind;
  /**
   * Long-horizon dedupe key claimed in email_sends BEFORE sending (unique
   * index). Use for once-per-lifetime / once-per-window sends. Short-horizon
   * webhook-retry dedupe stays with lib/email/idempotency.ts.
   */
  sendKey?: string;
  /** Attribution recorded in the send log and attached as Resend tags. */
  memberId?: number;
  journeyId?: string;
  stepId?: string;
  campaign?: string;
}

/**
 * The single choke point ALL email passes through. Applies the dev-mode
 * whitelist gate, the marketing suppression check, send-log dedupe/audit,
 * renders the registered React Email template, and sends via Resend. Returns a
 * structured result so callers can record it in a tracer span (sent / skipped /
 * suppressed) rather than throwing on no-ops.
 */
export async function sendTemplate<K extends EmailTemplateKey>({
  to,
  template,
  props,
  kind = 'transactional',
  sendKey,
  memberId,
  journeyId,
  stepId,
  campaign,
}: SendTemplateArgs<K>): Promise<SendResult> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[Email] Resend not configured — skipping ${template} to ${to}`);
    return { status: 'skipped', reason: 'resend-not-configured' };
  }

  if (isDevMode() && !isAllowedRecipient(to)) {
    console.info(`[Email] Dev mode: suppressing ${template} to ${to} (not whitelisted)`);
    return { status: 'suppressed', reason: 'dev-mode-not-whitelisted' };
  }

  const logEntry = {
    email: to,
    memberId,
    template,
    kind,
    journeyId,
    stepId,
    campaign,
    sendKey,
  };

  let unsubscribeUrl: string | undefined;
  const headers: Record<string, string> = {};

  if (kind === 'marketing') {
    // Suppression fails CLOSED (no store -> suppressed); compliance beats reach.
    if (await isSuppressed(to)) {
      console.info(`[Email] ${to} is suppressed — not sending ${template}`);
      await recordSend(logEntry, 'suppressed');
      return { status: 'suppressed', reason: 'unsubscribed' };
    }

    unsubscribeUrl = buildUnsubscribeUrl(to);
    if (!unsubscribeUrl) {
      // A marketing email without a working unsubscribe link is a compliance
      // bug, not a degraded mode — refuse to send.
      console.error(`[Email] No UNSUBSCRIBE_SECRET/CRON_SECRET — cannot send marketing email`);
      return { status: 'skipped', reason: 'unsubscribe-url-unavailable' };
    }
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  // Claim the dedupe key before sending; a conflict means another run got here
  // first (or already succeeded in the past).
  let claimedId: string | undefined;
  if (sendKey) {
    const claim = await claimSend(logEntry);
    if (claim.outcome === 'duplicate') {
      return { status: 'skipped', reason: 'already-sent' };
    }
    if (claim.outcome === 'unavailable') {
      // Without the log we cannot guarantee once-only semantics — don't send.
      return { status: 'skipped', reason: 'send-log-unavailable' };
    }
    claimedId = claim.id;
  }

  const entry = EMAIL_TEMPLATES[template];
  const from = import.meta.env.RESEND_FROM ?? 'Pyre <hello@pyresauna.com>';

  // Marketing templates declare unsubscribeUrl in their props; injecting it here
  // means no call site can forget it. Harmless extra prop for transactional.
  const renderProps = unsubscribeUrl
    ? ({ ...props, unsubscribeUrl } as EmailPropsByTemplate[K])
    : props;

  const tags = [
    { name: 'template', value: template },
    { name: 'kind', value: kind },
    ...(journeyId ? [{ name: 'journey', value: journeyId }] : []),
    ...(stepId ? [{ name: 'step', value: stepId }] : []),
    ...(campaign ? [{ name: 'campaign', value: campaign }] : []),
  ];

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: entry.subject(props),
      react: createElement(entry.Component, renderProps),
      ...(Object.keys(headers).length > 0 && { headers }),
      tags,
    });

    if (error) {
      throw new Error(`Resend send failed for ${template}: ${error.message ?? String(error)}`);
    }

    if (claimedId) {
      await attachResendId(claimedId, data?.id);
    } else {
      await recordSend(logEntry, 'sent', data?.id);
    }

    return { status: 'sent', id: data?.id };
  } catch (error) {
    // Free the claim so a later sweep can retry (at-most-once semantics).
    if (claimedId) await releaseSend(claimedId);
    throw error;
  }
}
