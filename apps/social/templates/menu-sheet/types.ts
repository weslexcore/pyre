import type { MenuItem } from '../menu/types.ts';

export type { MenuItem } from '../menu/types.ts';

/** A menu item plus the sheet-only fine print (credit expiry, rollover terms). */
export interface MenuSheetItem extends MenuItem {
  /** Small muted line under the row — e.g. "valid 3 months". */
  note?: string;
}

export interface MenuCategory {
  title: string;
  items: MenuSheetItem[];
}

export interface MenuSheetData {
  eyebrow: string;
  heading: string;
  categories: MenuCategory[];
  /** Optional fine print spanning the full width, above the pine mark. */
  footnote?: string;
}
