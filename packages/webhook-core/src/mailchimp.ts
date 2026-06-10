import { createHash } from 'node:crypto';
import { createWebhookLogger } from './logger';

const log = createWebhookLogger('Mailchimp');

function getConfig() {
  const apiKey = import.meta.env.MAILCHIMP_API_KEY;
  const audienceId = import.meta.env.MAILCHIMP_AUDIENCE_ID;

  if (!apiKey) throw new Error('MAILCHIMP_API_KEY not configured');
  if (!audienceId) throw new Error('MAILCHIMP_AUDIENCE_ID not configured');

  // API key format: "key-dc" (e.g., "abc123-us18")
  const dc = apiKey.split('-').pop();
  const baseUrl = `https://${dc}.api.mailchimp.com/3.0`;

  const headers = {
    Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };

  return { baseUrl, audienceId, headers };
}

function getSubscriberHash(email: string): string {
  return createHash('md5').update(email.toLowerCase()).digest('hex');
}

function formatBirthday(birthday: string): string {
  // Momence may send ISO date (e.g., "1990-03-15") or other formats
  // Mailchimp BIRTHDAY merge field expects "MM/DD"
  const date = new Date(birthday);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}/${day}`;
}

// --- Subscriber management ---

export interface UpsertSubscriberParams {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  birthday?: string;
}

export async function upsertSubscriber({
  email,
  firstName,
  lastName,
  phone,
  birthday,
}: UpsertSubscriberParams): Promise<void> {
  const { baseUrl, audienceId, headers } = getConfig();
  const hash = getSubscriberHash(email);

  log.info(`Upserting subscriber ${email}`);

  const response = await fetch(`${baseUrl}/lists/${audienceId}/members/${hash}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      merge_fields: {
        FNAME: firstName,
        LNAME: lastName,
        ...(phone && { PHONE: phone }),
        ...(birthday && { BIRTHDAY: formatBirthday(birthday) }),
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Mailchimp upsert failed (${response.status}): ${error.detail}`);
  }

  log.info(`Subscriber ${email} upserted successfully`);
}

// --- Tags ---

export interface SubscriberTag {
  name: string;
  status: 'active' | 'inactive';
}

export interface MailchimpTag {
  id: number;
  name: string;
  member_count: number;
}

export async function listTags(): Promise<MailchimpTag[]> {
  const { baseUrl, audienceId, headers } = getConfig();

  log.info('Listing tags');

  const response = await fetch(
    `${baseUrl}/lists/${audienceId}/segments?type=static&count=1000&fields=segments.id,segments.name,segments.member_count`,
    { headers }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Mailchimp listTags failed (${response.status}): ${error.detail}`);
  }

  const data = (await response.json()) as { segments: MailchimpTag[] };
  return data.segments;
}

export async function setSubscriberTags(email: string, tags: SubscriberTag[]): Promise<void> {
  const { baseUrl, audienceId, headers } = getConfig();
  const hash = getSubscriberHash(email);

  log.info(`Setting tags on ${email}`, { tags: tags.map((t) => t.name) });

  const response = await fetch(`${baseUrl}/lists/${audienceId}/members/${hash}/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tags }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Mailchimp tags failed (${response.status}): ${error.detail}`);
  }

  log.info(`Tags set on ${email} successfully`);
}

// --- Address ---

export interface SubscriberAddress {
  addr1: string;
  city: string;
  zip: string;
  country: string;
}

export async function updateSubscriberAddress(
  email: string,
  address: SubscriberAddress | null
): Promise<void> {
  const { baseUrl, audienceId, headers } = getConfig();
  const hash = getSubscriberHash(email);

  log.info(`Updating address for ${email}`, { address });

  const response = await fetch(`${baseUrl}/lists/${audienceId}/members/${hash}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      merge_fields: {
        ADDRESS: address
          ? {
              addr1: address.addr1,
              city: address.city,
              zip: address.zip,
              country: address.country,
            }
          : { addr1: '', city: '', zip: '', country: '' },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Mailchimp address update failed (${response.status}): ${error.detail}`);
  }

  log.info(`Address updated for ${email} successfully`);
}
