import { founding } from './membership';

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
  /** Optional URL that makes the entire banner clickable. */
  href?: string;
  /** Whether the banner is currently active. Set to false to disable without removing code. */
  enabled: boolean;
  /** Optional ISO 8601 datetime string. Banner auto-hides client-side after this time. */
  expiresAt?: string;
  /** Show a "N days left" founding-membership countdown after the text. */
  foundingCountdown?: boolean;
}

const banner: BannerConfig = {
  id: 'founding-unlimited-through-dec-31',
  text: founding.announcement,
  href: founding.unlimited.href,
  expiresAt: founding.endsAt,
  foundingCountdown: true,
  enabled: true,
};

export default banner;
