import { createElement } from 'react';
import { EMAIL_TEMPLATES } from '@/emails/registry';
import type { EmailPropsByTemplate, EmailTemplateKey } from '@/emails/types';
import { isAllowedRecipient, isDevMode } from './dev-mode';
import { getResend } from './resend';

export type SendResult =
  | { status: 'sent'; id?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'suppressed'; reason: string };

interface SendTemplateArgs<K extends EmailTemplateKey> {
  to: string;
  template: K;
  props: EmailPropsByTemplate[K];
}

/**
 * The single choke point ALL transactional email passes through. Applies the
 * dev-mode whitelist gate, renders the registered React Email template, and
 * sends via Resend. Returns a structured result so callers can record it in a
 * tracer span (sent / skipped / suppressed) rather than throwing on no-ops.
 */
export async function sendTemplate<K extends EmailTemplateKey>({
  to,
  template,
  props,
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

  const entry = EMAIL_TEMPLATES[template];
  const from = import.meta.env.RESEND_FROM ?? 'Pyre <hello@pyresauna.com>';

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: entry.subject(props),
    react: createElement(entry.Component, props),
  });

  if (error) {
    throw new Error(`Resend send failed for ${template}: ${error.message ?? String(error)}`);
  }

  return { status: 'sent', id: data?.id };
}
