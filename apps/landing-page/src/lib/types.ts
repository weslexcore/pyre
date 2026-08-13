// TypeScript interfaces for Pyre design system components

export interface ServiceCardProps {
  title: string;
  description: string;
  image: string;
  symbol: string;
  count: string;
}

export interface ButtonProps {
  variant: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  children: unknown;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}

export interface FormFieldProps {
  label: string;
  name: string;
  type: 'text' | 'email' | 'tel' | 'textarea';
  required?: boolean;
  placeholder?: string;
  error?: string;
  description?: string;
}

export interface ColorComboProps {
  primary: 'pyre-black' | 'pyre-creme' | 'pyre-red' | 'pyre-blue';
  secondary: 'pyre-black' | 'pyre-creme' | 'pyre-red' | 'pyre-blue';
}

export interface TypographyProps {
  fontFamily: 'primary' | 'mono';
  weight: 'regular' | 'semibold' | 'bold';
  size: 'scale-1' | 'scale-2' | 'scale-3' | 'scale-4' | 'scale-5' | 'scale-6';
  lineHeight?: 'tight' | 'normal' | 'relaxed';
  letterSpacing?: 'tight' | 'normal' | 'loose' | 'variable';
}

export interface SymbolProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
}

// Design system configuration types
export interface DesignSystemConfig {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    neutral: string;
  };
  typography: {
    fontFamilies: Record<string, string>;
    fontWeights: Record<string, number>;
    lineHeights: Record<string, number>;
  };
  spacing: {
    scale: number[];
    container: Record<string, string>;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}

// ------------------------------------------------------------
// Marketing site content config types
// ------------------------------------------------------------

export interface ImageRef {
  src: string;
  alt?: string;
  ariaLabel?: string;
}

export interface LinkRef {
  label: string;
  href: string;
  ariaLabel?: string;
  icon?: string;
}

export interface ActionRef {
  label: string;
  href: string;
  ariaLabel?: string;
}

export interface HeroContent {
  elements: {
    heroText: string;
    subText: string;
    bottomLine: string;
    leftWord: string;
    rightWord: string;
  };
  actions?: {
    primary?: ActionRef;
  };
}

export interface NavbarContent {
  images: {
    brandMark: ImageRef;
  };
  elements: {
    ariaLabel: string;
    links?: Array<LinkRef>;
  };
  actions?: {
    primary?: ActionRef;
    secondary?: ActionRef;
    login?: ActionRef;
    social?: {
      instagram?: LinkRef;
    };
  };
}

export interface StoryContent {
  elements: {
    title: string;
    body: string[];
    emphasisList?: string[];
  };
  actions?: {
    primary?: ActionRef;
  };
}

export interface ExperiencesItem {
  icon?: string;
  title: string;
  description: string;
  bullets?: string[];
  link?: LinkRef;
  linkText?: string;
}

export interface ExperiencesContent {
  elements: {
    // backgroundVideoId: string;
    title: string;
    items: Array<ExperiencesItem>;
  };
  actions?: {
    primary?: ActionRef;
  };
}

export interface BreakSectionContent {
  elements: {
    headingTop: string;
    words: string[];
    buttonLabel: string;
    intervalMs?: number;
  };
  actions?: {
    primary?: ActionRef;
  };
}

// Copy for the partner-membership verification form (PartnerVerifyForm.astro).
// Lives with each partner page's content config (e.g. bft.ts) so a second
// partner is just another config object.
export interface PartnerVerifyCopy {
  firstNameLabel: string;
  firstNamePlaceholder: string;
  lastNameLabel: string;
  lastNamePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  emailHelp: string;
  phoneLabel: string;
  phonePlaceholder: string;
  partnerEmailLabel: string;
  partnerEmailPlaceholder: string;
  submitLabel: string;
  submittingLabel: string;
  successMessage: string;
  errorMessage: string;
}

export interface SignupFormContent {
  elements: {
    title: string;
    subtitle: string;
    emailLabel: string;
    submitLabel: string;
    successMessage: string;
    errorMessage: string;
  };
  mailchimp: {
    action: string;
    audienceU: string;
    audienceId: string;
    fId: string;
    tagId: string;
    honeypotFieldName: string;
    postJson?: string;
  };
  antiSpam: {
    honeypotFields: {
      website: string;
      phone: string;
      confirmEmail: string;
    };
    timestampField: string;
    minSubmissionTime: number; // seconds
    trackInteractions: boolean;
  };
  turnstile: {
    siteKey: string;
    theme?: 'light' | 'dark' | 'auto';
    size?: 'normal' | 'compact';
  };
  metadata?: {
    subscribedParam?: string;
  };
}

export interface CertificationBadge {
  image: ImageRef;
  title: string;
  link: string;
  ariaLabel: string;
}

export interface FooterContent {
  elements: {
    hoursHeading: string;
    hoursText: string;
    locationHeading: string;
    locationText: string;
    contactHeading: string;
    copyright: string;
  };
  actions?: {
    contactEmail?: string;
    instagram?: LinkRef;
  };
  groups?: Array<FooterNavGroup>;
  certifications?: CertificationBadge[];
}

export interface FooterNavGroup {
  title: string;
  links: Array<LinkRef>;
}

// ------------------------------------------------------------
// Booking configuration types
// ------------------------------------------------------------

export interface BookingContent {
  label: string;
  bookingBaseUrl: string;
  utmSource: string;
  ariaLabel: string;
}

// ------------------------------------------------------------
// Video optimization manifest types
// ------------------------------------------------------------

export interface VideoPoster {
  url: string;
  width: number;
  height: number;
  type: string; // e.g., 'image/jpeg' | 'image/webp'
}

export interface VideoVariant {
  format: 'mp4' | 'webm' | 'av1';
  codec: string;
  width: number;
  height: number;
  bitrateKbps?: number;
  url: string; // public URL path under BASE_URL
}

export interface VideoSourceEntry {
  id: string; // derived from basename
  sourcePath: string; // original public path, e.g., '/videos/running_water.MOV'
  contentHash: string; // sha256 of bytes + settings signature
  width: number;
  height: number;
  durationSec: number;
  variants: Array<VideoVariant>;
  poster?: VideoPoster;
  preview?: { url: string; durationSec: number };
}

export interface VideoManifest {
  pipelineVersion: string;
  generatedAt: string; // ISO timestamp
  sources: Array<VideoSourceEntry>;
}

// ------------------------------------------------------------
// Legal policy content config types
// ------------------------------------------------------------

export interface PolicyListItem {
  text: string;
}

export interface PolicyList {
  title?: string;
  items: Array<PolicyListItem>;
}

export interface PolicySection {
  heading: string;
  paragraphs?: Array<string>;
  lists?: Array<PolicyList>;
}

export interface PolicyDocument {
  title: string;
  effectiveDate?: string;
  lastUpdated?: string;
  intro?: string;
  headerImage?: ImageRef;
  sections: Array<PolicySection>;
}

// ------------------------------------------------------------
// Location content types
// ------------------------------------------------------------

export interface DayHours {
  day: string;
  open: string;
  close: string;
}

export interface LocationContent {
  name: string;
  neighborhood: string;
  address: string;
  phone: string;
  email?: string;
  instagram: string;
  instagramUrl: string;
  mapsUrl?: string;
  hours: DayHours[];
  tagline?: string;
}

// ------------------------------------------------------------
// FAQ content types
// ------------------------------------------------------------

export interface FAQItem {
  question: string;
  answer: string;
}

export interface FAQContent {
  title: string;
  items: FAQItem[];
}

// ------------------------------------------------------------
// Membership pricing types
// ------------------------------------------------------------

export interface MembershipFeature {
  text: string;
  highlighted?: boolean;
}

export interface DropSession {
  id: string;
  name: string;
  price: number;
  duration: string;
  description: string;
  cta: ActionRef;
}

export interface MembershipTier {
  id: string;
  name: string;
  price: number;
  /** Normal (non-founding) monthly rate, shown struck through where applicable */
  originalPrice?: number;
  period: string;
  description: string;
  savings?: number;
  features: MembershipFeature[];
  cta: ActionRef;
  popular?: boolean;
}

export interface MembershipContent {
  title: string;
  subtitle?: string;
  note?: string;
  tiers: MembershipTier[];
  dropIn?: {
    title: string;
    sessions: DropSession[];
  };
}

// ------------------------------------------------------------
// Events content types
// ------------------------------------------------------------

export interface EventItem {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  image?: ImageRef;
  cta?: ActionRef;
  isoDate?: string; // ISO 8601 date for client-side filtering
  durationMinutes?: number; // Session length in minutes (Momence `duration`), used for occupancy math
  priceUsd?: number; // Drop-in price in USD (Momence `fixedPrice`); credit cost is derived from this
  spotsRemaining?: number; // Available spots from Momence API
  totalSpots?: number; // Total capacity from Momence API
  isPrivate?: boolean; // Private events hide booking CTAs
  tags?: string[]; // Momence category tags, used for type filtering on the events page
  // People leading the session, resolved from the Momence teacher roster (see
  // `lib/practitioners`). Special events surface these as a practitioner
  // credit; house-account sessions resolve to an empty list.
  practitioners?: Practitioner[];
}

// A guest practitioner who hosts special events. Momence only gives us a name,
// so the headshot, bio, and links come from the roster in `practitioners.ts`.
export interface Practitioner {
  name: string; // Must match the Momence teacher name (matching is case/punctuation-insensitive)
  role?: string; // Short descriptor, e.g. "Qigong Instructor"
  photo?: ImageRef; // Headshot; falls back to a monogram avatar when absent
  bio?: string[]; // One entry per paragraph. Without a bio there is nothing to open.
  links?: LinkRef[]; // Optional website / social links shown at the bottom of the bio
}

export interface EventsContent {
  title: string;
  subtitle?: string;
  items: EventItem[];
  viewAllCta?: ActionRef;
  // Required: EventsSection renders the empty state unconditionally when no
  // events are available.
  emptyState: {
    message: string;
    cta?: ActionRef;
  };
}

// A bookable duration choice for a pooled slot (e.g. "Book 1 hour" / "Book 2
// hours" for Open Hours, "Book 3 hours" for a social evening), surfaced in the
// event detail modal. `href` is the Momence session checkout for that duration;
// `soldOut` covers both a full pool and a missing full-length partner session.
export interface PooledBookingOption {
  label: string;
  minutes: number;
  href: string;
  spotsLeft: number;
  soldOut: boolean;
  credits: number; // Credit cost, derived from the Momence drop-in price
  priceUsd?: number; // Momence drop-in price in USD, shown alongside the credits
}

// ------------------------------------------------------------
// About section types
// ------------------------------------------------------------

export interface AboutContent {
  title: string;
  body: string[];
  expandedBody?: string[];
  cta?: ActionRef;
}

// ------------------------------------------------------------
// Benefits section types
// ------------------------------------------------------------

export interface BenefitItem {
  title: string;
  description: string;
  icon?: string;
  image?: string;
}

export interface BenefitsContent {
  title: string;
  subtitle?: string;
  items: BenefitItem[];
  closing?: string;
  cta?: ActionRef;
}

// ------------------------------------------------------------
// Testimonials section types
// ------------------------------------------------------------

export interface TestimonialItem {
  id: string;
  name: string;
  quote: string;
  sessionType?: string;
  image?: ImageRef;
  highlight?: boolean;
}

export interface TestimonialsContent {
  title: string;
  subtitle?: string;
  items: TestimonialItem[];
  closing?: string;
  cta?: ActionRef;
}

// ------------------------------------------------------------
// Group Booking section types
// ------------------------------------------------------------

export interface GroupBookingOccasion {
  icon?: string;
  label: string;
}

export interface GroupBookingContent {
  title: string;
  subtitle?: string;
  description: string[];
  capacity: {
    max: number;
    label: string;
  };
  occasions?: GroupBookingOccasion[];
  features?: string[];
  email?: string;
  cta: ActionRef;
  secondaryCta?: ActionRef;
}

// ------------------------------------------------------------
// Private rentals section types
// ------------------------------------------------------------

export interface PrivateRentalTier {
  name: string;
  price: number;
  extraDayPrice: number;
  features: string[];
  imageAlt: string;
}

export interface PrivateRentalsContent {
  title: string;
  subtitle?: string;
  description: string[];
  unitSummary: string;
  periodLabel: string;
  logistics: string[];
  addonSummary: string;
  tiers: [PrivateRentalTier, PrivateRentalTier];
  email?: string;
  cta: ActionRef;
}

// ------------------------------------------------------------
// Gift Card section types
// ------------------------------------------------------------

export interface GiftCardContent {
  title: string;
  subtitle?: string;
  description: string[];
  cta: ActionRef;
}

// ------------------------------------------------------------
// Shop / merchandise types
// ------------------------------------------------------------

import type { ImageMetadata } from 'astro';

export interface ShopImage {
  src: ImageMetadata;
  alt: string;
}

export interface ShopVariant {
  name: string;
  price?: number;
  soldOut?: boolean;
}

export interface ShopProduct {
  id: string;
  momenceId?: number;
  name: string;
  description?: string;
  price: number;
  category: string;
  images: ShopImage[];
  purchaseUrl: string;
  variants?: ShopVariant[];
  badge?: string;
  soldOut?: boolean;
}

export interface MomenceProductVariant {
  id: number;
  name: string;
  price: number;
  link: string;
  leftInStock: number | null;
  isDeleted: boolean;
}

export interface MomenceProduct {
  id: number;
  name: string;
  description: string | null;
  link: string;
  imageLink: string;
  price: number;
  leftInStock: number | null;
  category?: string;
  isDeleted: boolean;
  availableForShipping: boolean;
  variants: MomenceProductVariant[];
}

export interface ShopContent {
  title: string;
  subtitle?: string;
  products: ShopProduct[];
  emptyMessage?: string;
}

export interface StockVariantInfo {
  name: string;
  price?: number;
  soldOut: boolean;
}

export interface StockInfo {
  price: number;
  purchaseUrl: string;
  soldOut: boolean;
  variants: StockVariantInfo[];
}

export type StockMap = Record<string, StockInfo>;

// ------------------------------------------------------------
// Blog types
// ------------------------------------------------------------

export type {
  BlogFilters,
  BlogPost,
  BlogPostCard,
  BlogPostData,
  ProcessedBlogPost,
  TagWithCount,
} from './blog-types';
