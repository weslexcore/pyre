// The journey editor's panels, rendered on the server with a realistic
// journey: every section and labelled field shows, and each step and email
// block has a drag handle.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { definitionSchema } from '@/lib/email/journeys/schema';
import { OverviewPanel } from './OverviewPanel';
import { StepsPanel } from './StepsPanel';

const definition = definitionSchema.parse({
  trigger: { type: 'sweep', inactiveDays: 30, maxInactiveDays: 60 },
  enrollIf: [{ type: 'has-active-membership', negate: true }],
  exitIf: [{ type: 'visited-since-enrollment' }],
  reentry: { mode: 'cooldown', days: 90 },
  steps: [
    {
      key: 'credits',
      name: 'You still have credits',
      timing: { anchor: 'trigger', offsetHours: 1 },
      skipIf: [{ type: 'has-credits', negate: true }],
      content: {
        type: 'blocks',
        subject: 'You still have {{creditsLabel}}',
        blocks: [
          { type: 'heading', text: 'We miss you' },
          { type: 'button', label: 'Book', url: 'https://pyresauna.com/events' },
        ],
      },
    },
    {
      key: 'offer',
      name: 'Come-back discount',
      timing: { anchor: 'previous', offsetHours: 24 },
      content: { type: 'none' },
    },
  ],
});

const noop = () => {};

describe('journey editor panels', () => {
  it('lays the settings out as numbered sections with labelled, explained fields', () => {
    const html = renderToStaticMarkup(
      <OverviewPanel
        journeyId="win-back"
        journeyName="Win back"
        definition={definition}
        onChange={noop}
        tags={[]}
        campaigns={[]}
      />
    );
    for (const text of [
      'Who enters',
      'When they leave early',
      'Going through it again',
      'At the end',
      'Tracking',
      'Not seen for at least',
      'Only enroll people who',
      'Take them out if',
    ]) {
      expect(html).toContain(text);
    }
    // Every field label carries an explanation.
    expect((html.match(/role="tooltip"/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('gives every step and every email block a drag handle', () => {
    const html = renderToStaticMarkup(
      <StepsPanel
        journeyId="win-back"
        definition={definition}
        savedStepKeys={new Set(['credits', 'offer'])}
        onChange={noop}
        tags={[]}
        viewerEmail="wes@pyresauna.com"
      />
    );
    expect(html).toContain('Drag to reorder You still have credits');
    expect(html).toContain('Drag to reorder Come-back discount');
    // The selected (first) step's email has two blocks.
    expect(html).toContain('Drag to reorder Heading');
    expect(html).toContain('Drag to reorder Button');
    expect(html).toContain('When it goes out');
    expect(html).toContain('Skip it for some people');
    expect(html).toContain('Subject line');
  });
});
