// Static-markup render of Pyre Agent's dock: the closed launcher, and the
// chat's dock variant against the full page's layout.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PyreAgentDock } from './PyreAgentDock';
import { SopAsk } from './SopAsk';

describe('PyreAgentDock', () => {
  it('starts as a closed launcher, with the chat not mounted yet', () => {
    const html = renderToStaticMarkup(<PyreAgentDock />);
    expect(html).toContain('Pyre Agent');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('pyre-agent-launcher');
    // Nothing fetches history until someone opens the window.
    expect(html).not.toContain('id="pyre-agent-dock"');
    expect(html).not.toContain('<textarea');
  });
});

describe('SopAsk variants', () => {
  it('keeps the history sidebar on the full page', () => {
    const html = renderToStaticMarkup(<SopAsk />);
    expect(html).toContain('<aside');
    expect(html).toContain('id="ask-question"');
  });

  it('drops the sidebar in the dock and shows History / New chat at every width', () => {
    const html = renderToStaticMarkup(<SopAsk variant="dock" />);
    expect(html).not.toContain('<aside');
    expect(html).toContain('id="ask-question-dock"');
    const toolbar = /<div class="([^"]*)"><button[^>]*>History/.exec(html)?.[1] ?? '';
    expect(toolbar).not.toBe('');
    expect(toolbar.split(' ')).not.toContain('md:hidden');
  });
});
