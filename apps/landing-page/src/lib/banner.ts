export interface BannerConfig {
  /** Unique ID used as the localStorage key. Change this to show a new announcement. */
  id: string;
  /** The announcement text displayed in the banner. */
  text: string;
  /** Optional CTA link displayed alongside the text. */
  link?: {
    label: string;
    href: string;
    /** Opens in a new tab if true. Defaults to false. */
    external?: boolean;
  };
  /** Whether the banner is currently active. Set to false to disable without removing code. */
  enabled: boolean;
  /** Optional ISO 8601 datetime string. Banner auto-hides client-side after this time. */
  expiresAt?: string;
}

const banner: BannerConfig = {
  id: 'founding-membership-launch',
  text: 'Founding Memberships Are Here - 20% off unlimited membership for life with code SECRETGARDEN through April 23rd',
  expiresAt: '2026-04-23T00:00:00-04:00',
  enabled: true,
};

export default banner;
