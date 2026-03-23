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
  period: string;
  description: string;
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
  spotsRemaining?: number; // Available spots from Momence API
  totalSpots?: number; // Total capacity from Momence API
  isPrivate?: boolean; // Private events hide booking CTAs
}

export interface EventsContent {
  title: string;
  subtitle?: string;
  items: EventItem[];
  viewAllCta?: ActionRef;
  emptyState?: {
    message: string;
    cta?: ActionRef;
  };
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
  role: string;
  quote: string;
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
