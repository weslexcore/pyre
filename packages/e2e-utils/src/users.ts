// Per-test identities for suites that share one database across parallel
// workers and device projects.

import type { TestInfo } from '@playwright/test';

/**
 * An email address unique to this test, project and retry, e.g.
 * `lost-found-mobile-safari-r0-k3f9q2@e2e.test`. Seed rows under it so
 * parallel tests never see each other's data.
 */
export function uniqueEmail(testInfo: TestInfo, label = 'user'): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${slug}-${project}-r${testInfo.retry}-${nonce}@e2e.test`;
}

/** A short token unique to this test run, for names and titles. */
export function uniqueTag(testInfo: TestInfo, label = 'e2e'): string {
  return `${label} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 8)}`;
}
