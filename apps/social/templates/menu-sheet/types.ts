import type { MenuItem } from '../menu/types.ts';

export type { MenuItem } from '../menu/types.ts';

/** A menu item plus the sheet-only fine print (credit expiry, rollover terms). */
export interface MenuSheetItem extends MenuItem {
  /** Small muted line under the row — e.g. "valid 3 months". */
  note?: string;
}

export interface MenuCategory {
  title: string;
  /** Muted terms under the category title that apply to every item — e.g. "expire 3 months from purchase". */
  note?: string;
  items: MenuSheetItem[];
}

/** A secondary offer nested inside the feature panel (e.g. an intro trial into the membership). */
export interface MenuSheetOffer {
  label: string;
  name: string;
  price: string;
  description?: string;
}

/** Full-width spotlight panel between the header and the categories, for the one item the sheet sells hardest. */
export interface MenuSheetFeature {
  label: string;
  name: string;
  price: string;
  perks: string[];
  offer?: MenuSheetOffer;
}

export interface MenuSheetData {
  /** Optional small label beside the heading. */
  eyebrow?: string;
  /** Optional page title. With no eyebrow either, the header is left out entirely. */
  heading?: string;
  /** Optional spotlight panel above the categories. */
  feature?: MenuSheetFeature;
  categories: MenuCategory[];
  /** Optional fine print spanning the full width, above the pine mark. */
  footnote?: string;
}
