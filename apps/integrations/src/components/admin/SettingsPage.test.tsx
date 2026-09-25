// The settings page, rendered on the server: each setting with its control
// and where its value comes from.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SettingView } from '@/lib/settings/registry';
import { SettingsPage } from './SettingsPage';

const settings: SettingView[] = [
  {
    key: 'suggestions.enabled',
    value: true,
    source: 'default',
    fallback: true,
    updatedBy: null,
    updatedAt: null,
  },
  {
    key: 'suggestions.auto',
    value: true,
    source: 'saved',
    fallback: false,
    updatedBy: 'wes@pyresauna.com',
    updatedAt: '2026-09-25T16:00:00Z',
  },
  {
    key: 'suggestions.autoSignals',
    value: ['action', 'update'],
    source: 'default',
    fallback: ['action', 'update'],
    updatedBy: null,
    updatedAt: null,
  },
];

describe('SettingsPage', () => {
  const html = renderToStaticMarkup(
    <SettingsPage initial={settings} people={{ 'wes@pyresauna.com': 'Wes' }} />
  );

  it('draws switches with their state', () => {
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Suggest automatically"');
    expect(html).toContain('aria-checked="true"');
  });

  it('says who saved a setting and offers the fallback back', () => {
    expect(html).toContain('Set here by Wes');
    expect(html).toContain('reset to off');
  });

  it('marks the chosen signals', () => {
    expect(html).toMatch(/aria-pressed="true"[^>]*>Action</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Question</);
  });

  it('points to the settings that live on other pages', () => {
    expect(html).toContain('href="/admin/schedule"');
    expect(html).toContain('href="/admin/email-templates"');
  });
});
