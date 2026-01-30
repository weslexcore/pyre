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
}

const banner: BannerConfig = {
  id: 'founding-membership',
  text: 'Founding Memberships Available Now',
  link: {
    label: 'Get Yours',
    href: '#membership',
  },
  enabled: true,
};

export default banner;
