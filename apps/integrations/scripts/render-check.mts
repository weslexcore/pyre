// Smoke test: render every email template to HTML with its preview props to
// confirm they compile and produce non-empty markup (the same render path Resend
// uses). Run with: tsx scripts/render-check.mts
import { render } from '@react-email/render';
import { createElement } from 'react';
import GeneralConfirmation from '../src/emails/templates/GeneralConfirmation';
import GuidedConfirmation from '../src/emails/templates/GuidedConfirmation';
import FirstTimerWelcome from '../src/emails/templates/FirstTimerWelcome';
import SocialConfirmation from '../src/emails/templates/SocialConfirmation';

const templates = [
  ['GuidedConfirmation', GuidedConfirmation],
  ['SocialConfirmation', SocialConfirmation],
  ['GeneralConfirmation', GeneralConfirmation],
  ['FirstTimerWelcome', FirstTimerWelcome],
] as const;

let failures = 0;
for (const [name, Component] of templates) {
  const props = (Component as unknown as { PreviewProps: Record<string, unknown> }).PreviewProps;
  try {
    const html = await render(createElement(Component as never, props as never));
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
