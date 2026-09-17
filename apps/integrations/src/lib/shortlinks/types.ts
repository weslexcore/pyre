// API shapes for the standalone short links page. Client-bundle-safe: no
// store imports.

/** A short link no campaign link owns, as the list renders it. */
export interface StandaloneShortLink {
  code: string;
  /** The public https://pyresauna.com/s/<code> URL. */
  shortUrl: string;
  /** Where it redirects. */
  url: string;
  label: string;
  clicks: number;
  createdAt: number;
  createdBy: string;
  /**
   * Set when the URL carries a utm_campaign that matches a campaign — a link
   * the old free-form tool minted for it. The campaign page lists it too.
   */
  campaign: { id: string; name: string } | null;
}

/** Any short link (campaign-owned or not) already pointing at a destination. */
export interface ExistingShortLink {
  code: string;
  shortUrl: string;
  url: string;
  label: string;
  clicks: number;
  /** The campaign whose link this is, when a campaign link owns it. */
  campaign: { id: string; name: string } | null;
}

export interface ShortLinkListResponse {
  links: StandaloneShortLink[];
  /** Short links in the store, standalone or not. */
  total: number;
  /** True when the store holds more than the newest page this list scanned. */
  truncated: boolean;
  origin: string;
}

export interface ShortLinkCheckResponse {
  /** For ?alias=: whether that code is already in use. */
  aliasTaken?: boolean;
  /** For ?url=: every short link already sending people to that destination. */
  existing?: ExistingShortLink[];
}
