// Helpers for the SOP and messages specs: creators for the documents and messages a test needs. Every
// creator names its rows uniquely per test and project, so specs running in
// parallel never read each other's data.

import { type APIRequestContext, expect, type TestInfo } from '@playwright/test';
import { APP_URL } from './env';
import type { Role } from './roles';

/** A slug unique to this test run: lowercase letters, digits and hyphens. */
export function uniqueSlug(testInfo: TestInfo, label: string): string {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `e2e-${label}-${project}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Three items; the second is required (`- [!]`), so it can never be skipped. */
export const CHECKLIST = [
  '# Close the sauna',
  '',
  '- [ ] Turn off the heaters',
  '- [!] Lock the back door',
  '- [ ] Empty the towel bins',
].join('\n');

export const CHECKLIST_ITEMS = [
  'Turn off the heaters',
  'Lock the back door',
  'Empty the towel bins',
];

export interface SopInput {
  slug: string;
  title?: string;
  content?: string;
  viewRoles?: string[];
  editRoles?: string[];
  viewEmails?: string[];
  editEmails?: string[];
}

export interface CreatedSop {
  id: string;
  slug: string;
  title: string;
  current_version: number;
}

/** Create an SOP through the admin API (as the admin), so its v1 and notices exist. */
export async function createSop(admin: APIRequestContext, input: SopInput): Promise<CreatedSop> {
  const response = await admin.post('/api/admin/sops', {
    data: {
      title: input.title ?? `E2E ${input.slug}`,
      content: input.content ?? CHECKLIST,
      ...input,
    },
  });
  expect(response.status(), `create SOP ${input.slug}: ${await response.text()}`).toBe(201);
  return ((await response.json()) as { sop: CreatedSop }).sop;
}

export interface MessageInput {
  title: string;
  bodyMd?: string;
  audienceRoles?: string[];
  audienceEmails?: string[];
  requiresAck?: boolean;
  draft?: boolean;
  email?: boolean;
}

export interface CreatedMessage {
  id: string;
  title: string;
  updated_at: string;
}

/** Post (or draft) a message as the admin. Email is off unless a test asks for it. */
export async function postMessage(
  admin: APIRequestContext,
  input: MessageInput
): Promise<{ message: CreatedMessage; notified: number; emailed: number }> {
  const response = await admin.post('/api/admin/messages', {
    data: {
      bodyMd: `Body of ${input.title}`,
      audienceRoles: [],
      email: false,
      ...input,
    },
  });
  expect(response.status(), `post message: ${await response.text()}`).toBe(201);
  return (await response.json()) as {
    message: CreatedMessage;
    notified: number;
    emailed: number;
  };
}
