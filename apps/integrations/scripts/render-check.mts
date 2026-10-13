// Smoke test: render every registered email template to HTML with its admin
// preview props to confirm they compile and produce non-empty markup (the
// same render path Resend uses). Run with: tsx scripts/render-check.mts
import { render } from '@react-email/render';
import { type ComponentType, createElement } from 'react';
import { EMAIL_PREVIEW_PROPS } from '../src/emails/preview-props';
import { EMAIL_TEMPLATES } from '../src/emails/registry';

let failures = 0;
for (const [name, entry] of Object.entries(EMAIL_TEMPLATES)) {
  const Component = entry.Component as unknown as ComponentType<Record<string, unknown>>;
  const props = EMAIL_PREVIEW_PROPS[name as keyof typeof EMAIL_PREVIEW_PROPS] as unknown as Record<
    string,
    unknown
  >;
  try {
    const html = await render(createElement(Component, props));
    const ok = html.includes('<html') && html.length > 200;
    console.log(`${ok ? '✓' : '✗'} ${name} — ${html.length} bytes`);
    if (!ok) failures++;
  } catch (err) {
    console.error(`✗ ${name} — render threw:`, err);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} template(s) failed to render`);
  process.exit(1);
}
console.log('\nAll templates rendered successfully.');
