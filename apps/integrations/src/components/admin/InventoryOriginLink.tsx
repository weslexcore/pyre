// Where an inventory count was read from, when the agent read it out of a
// shift note and an admin approved it: a link to the note, shown beside who
// counted it on the list, in an item's details, and in its change log. A
// count typed into the list has none.

import type { InventoryOrigin } from '@/lib/inventory/types';

export function CountOriginLink({ origin }: { origin: InventoryOrigin }) {
  const text = `from ${origin.label}`;
  return origin.href ? (
    <a
      href={origin.href}
      className="underline decoration-white/20 hover:text-white"
      title="The shift note this count was read from"
    >
      {text}
    </a>
  ) : (
    <span>{text}</span>
  );
}
