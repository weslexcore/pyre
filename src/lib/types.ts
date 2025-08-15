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
  metadata?: {
    subscribedParam?: string;
  };
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
}

export interface FooterNavGroup {
  title: string;
  links: Array<LinkRef>;
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
