export interface MenuItem {
  name: string;
  price: string;
  /** Optional pre-discount price, rendered struck-through before {@link price}. */
  originalPrice?: string;
  chips?: string[];
  description?: string;
  /** Renders {@link description} as a gold accent badge (e.g. "best value"). */
  highlighted?: boolean;
}

export interface MenuFooter {
  address: string;
}

export interface MenuData {
  eyebrow: string;
  heading: string;
  items: MenuItem[];
  footer: MenuFooter;
}
