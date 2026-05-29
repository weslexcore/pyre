export interface MenuItem {
  name: string;
  price: string;
  chips?: string[];
  description?: string;
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
