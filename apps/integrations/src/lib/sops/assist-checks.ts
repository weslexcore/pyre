// What a writing-assistant proposal (lib/sops/assist.ts) did to the parts of
// an SOP the app depends on, so the editor can say so before anyone accepts
// it: checklist items (runs and their progress count them), required `- [!]`
// markers (runs refuse to skip them), and links to other documents (parent
// checklists show their progress). The assistant is told to keep all three;
// this is how a person checks it did. Client-bundle-safe.

import { parseChecklist } from './checklist';
import { linkedSopSlugs } from './links';

export interface AssistStructureWarning {
  kind: 'tasks' | 'required' | 'links';
  message: string;
}

export function assistStructureWarnings(before: string, after: string): AssistStructureWarning[] {
  const warnings: AssistStructureWarning[] = [];
  const a = parseChecklist(before).tasks;
  const b = parseChecklist(after).tasks;

  if (a.length !== b.length) {
    warnings.push({
      kind: 'tasks',
      message:
        b.length === 0
          ? `Removes all ${a.length} checklist items, so this would no longer run as a checklist.`
          : a.length === 0
            ? `Adds ${b.length} checklist items, so this would start running as a checklist.`
            : `Changes the checklist from ${a.length} to ${b.length} items.`,
    });
  }

  const requiredBefore = a.filter((task) => task.required).length;
  const requiredAfter = b.filter((task) => task.required).length;
  if (requiredAfter < requiredBefore) {
    warnings.push({
      kind: 'required',
      message: `Drops ${requiredBefore - requiredAfter} required item${requiredBefore - requiredAfter === 1 ? '' : 's'} (marked - [!]).`,
    });
  }

  const linksAfter = new Set(linkedSopSlugs(after));
  const dropped = linkedSopSlugs(before).filter((slug) => !linksAfter.has(slug));
  if (dropped.length > 0) {
    warnings.push({
      kind: 'links',
      message: `Removes the link${dropped.length === 1 ? '' : 's'} to ${dropped.map((slug) => `/admin/sops/${slug}`).join(', ')}.`,
    });
  }

  return warnings;
}
