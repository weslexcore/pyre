import { describe, expect, it } from 'vitest';
import { assistStructureWarnings } from './assist-checks';

const BEFORE = `## Open
- [ ] Unlock the door
- [!] Test the cold tub chlorine
- [ ] [Clear towel hampers](/admin/sops/momence-dirty-towels)
`;

describe('assistStructureWarnings', () => {
  it('is quiet when items, required markers, and links survive a rewording', () => {
    const after = `## Opening
- [ ] Unlock the front door
- [!] Test the cold tub chlorine level
- [ ] [Empty the towel hampers](/admin/sops/momence-dirty-towels)
`;
    expect(assistStructureWarnings(BEFORE, after)).toEqual([]);
  });

  it('flags a changed item count, a dropped required marker, and a dropped link', () => {
    const after = `## Open
- [ ] Unlock the door
- [ ] Test the cold tub chlorine
`;
    expect(assistStructureWarnings(BEFORE, after).map((w) => w.kind)).toEqual([
      'tasks',
      'required',
      'links',
    ]);
  });

  it('says when a checklist would stop running as one', () => {
    const [warning] = assistStructureWarnings(BEFORE, '## Open\n\nUnlock the door.\n');
    expect(warning.message).toContain('no longer run as a checklist');
  });
});
