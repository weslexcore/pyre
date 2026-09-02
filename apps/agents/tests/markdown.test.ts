import { describe, expect, it } from 'vitest';
import {
  bestSection,
  cleanSnippet,
  headingAnchor,
  splitSections,
} from '../agent/lib/knowledge/markdown';

const GUIDE = `*Intro paragraph.*

## Quick reference

### Sauna at a glance

- Heart and circulation: strong evidence.

### Cold plunge at a glance

- Mood and alertness: moderate evidence.

### Cold plunge for women at a glance

- Same benefits, thinner evidence; most cold studies are men.

## Cold plunging

### Cold: mood

Plunging lifts mood for hours, plunging again keeps it.
`;

describe('headingAnchor', () => {
  it('matches the dashboard heading ids', () => {
    expect(headingAnchor('Cold plunge at a glance')).toBe('cold-plunge-at-a-glance');
    expect(headingAnchor("Women: iron, thyroid, and Raynaud's")).toBe('women-iron-thyroid-and-raynauds');
    expect(headingAnchor('[Safety](#safety) **first**')).toBe('safety-first');
    expect(headingAnchor('***')).toBeNull();
  });
});

describe('splitSections', () => {
  it('keeps the preamble and every heading, with fenced code intact', () => {
    const sections = splitSections('intro\n\n# A\n\n```\n# not a heading\n```\n\n## B\ntext');
    expect(sections.map((s) => [s.level, s.heading])).toEqual([
      [0, ''],
      [1, 'A'],
      [2, 'B'],
    ]);
    expect(sections[1].markdown).toContain('# not a heading');
  });
});

describe('bestSection', () => {
  const sections = splitSections(GUIDE);

  it('prefers the earliest section whose heading names the question', () => {
    expect(bestSection(sections, 'benefits of cold plunging')?.anchor).toBe('cold-plunge-at-a-glance');
  });

  it('lets a later section win only when its heading names more of the question', () => {
    expect(bestSection(sections, 'cold plunge women')?.anchor).toBe(
      'cold-plunge-for-women-at-a-glance'
    );
    expect(bestSection(sections, 'mood')?.anchor).toBe('cold-mood');
  });

  it('returns null when nothing matches', () => {
    expect(bestSection(sections, 'parrots')).toBeNull();
    expect(bestSection(sections, 'of')).toBeNull();
  });
});

describe('cleanSnippet', () => {
  it('strips markdown but keeps the match markers', () => {
    expect(cleanSnippet('- [ ] **Remove** [[cold]] [[plunge]] covers [study](https://x.y)')).toBe(
      'Remove [[cold]] [[plunge]] covers study'
    );
  });
});
