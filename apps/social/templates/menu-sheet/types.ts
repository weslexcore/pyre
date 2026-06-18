import type { MenuItem } from '../menu/types.ts';

export type { MenuItem } from '../menu/types.ts';

export interface MenuCategory {
  title: string;
  items: MenuItem[];
}

export interface MenuSheetData {
  eyebrow: string;
  heading: string;
  categories: MenuCategory[];
}
