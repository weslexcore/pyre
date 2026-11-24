// The mailing lists a sign-up form can add someone to. Everyone joins the
// newsletter; the volunteer page's form also joins the volunteer list (it was
// a Mailchimp tag on the same audience). Mirrors MAILING_LISTS in
// apps/integrations src/lib/mailing-list/subscribe.ts.

export const MAILING_LISTS = ['newsletter', 'volunteer'] as const;
export type MailingList = (typeof MAILING_LISTS)[number];

export interface MailingListSignup {
  email: string;
  list: MailingList;
  /** Which form, for the logs and PostHog (e.g. website_form, promo_popup). */
  source: string;
  turnstileToken: string;
  /** The form's honeypot and timing fields, re-checked by the route. */
  antiSpam: Record<string, string>;
}

export type MailingListResult = { ok: true } | { ok: false; error: string };

const FALLBACK_ERROR = 'Something went wrong. Please try again later.';

/** Browser side: send a sign-up to /api/mailing-list. Never throws. */
export async function submitMailingListSignup(
  signup: MailingListSignup
): Promise<MailingListResult> {
  try {
    const response = await fetch('/api/mailing-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...signup.antiSpam,
        email: signup.email,
        list: signup.list,
        source: signup.source,
        turnstileToken: signup.turnstileToken,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (response.ok && result.ok) return { ok: true };
    return { ok: false, error: result.error || FALLBACK_ERROR };
  } catch {
    return { ok: false, error: FALLBACK_ERROR };
  }
}

/** The honeypot and timing fields of a form, as the route expects them. */
export function antiSpamFields(
  form: HTMLFormElement,
  config: { honeypotFields: Record<string, string>; timestampField: string }
): Record<string, string> {
  const names = [...Object.values(config.honeypotFields), config.timestampField];
  const fields: Record<string, string> = {};
  for (const name of names) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (input) fields[name] = input.value;
  }
  return fields;
}
