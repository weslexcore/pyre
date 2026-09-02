import { describe, expect, it } from 'vitest';
import type { LinkedProgressMap } from '@/lib/sops/links';
import { linkedTargets } from './linkedCascade';

const LINKED: LinkedProgressMap = {
  hampers: { slug: 'hampers', sopId: 'sop-2', taskCount: 3, checked: 1, status: 'in_progress' },
  plunges: { slug: 'plunges', sopId: 'sop-3', taskCount: 2, checked: 0, status: 'none' },
  fire: { slug: 'fire', sopId: 'sop-4', taskCount: 2, checked: 2, status: 'completed' },
  full: { slug: 'full', sopId: 'sop-5', taskCount: 2, checked: 2, status: 'in_progress' },
};

describe('linkedTargets', () => {
  it('reaches the unfinished checklists the tapped items link to, once each', () => {
    const items = [
      {
        itemIndex: 0,
        itemText: '[Hampers](/admin/sops/hampers) and [plunges](/admin/sops/plunges)',
      },
      { itemIndex: 1, itemText: 'Again [hampers](/admin/sops/hampers)' },
      { itemIndex: 2, itemText: '[Fire](/admin/sops/fire) [full](/admin/sops/full)' },
      { itemIndex: 3, itemText: '[Unknown](/admin/sops/unknown) plain text' },
    ];
    expect(linkedTargets(items, LINKED).map((p) => p.slug)).toEqual(['hampers', 'plunges']);
  });

  it('is empty for items without library links', () => {
    expect(linkedTargets([{ itemIndex: 0, itemText: 'Wipe the glass' }], LINKED)).toEqual([]);
  });
});
