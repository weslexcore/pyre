/**
 * TypeScript interfaces and types for table of contents functionality
 */

export interface TOCHeader {
  /** The ID attribute of the header element (used for anchor links) */
  id: string;
  /** The text content of the header */
  text: string;
  /** The header level (2 for H2, 3 for H3, etc.) */
  level: number;
  /** The element reference for scroll tracking */
  element?: HTMLElement;
}

export interface TOCSection {
  /** Header information for this section */
  header: TOCHeader;
  /** Child sections (nested headers) */
  children: TOCSection[];
  /** Whether this section is currently active/visible */
  isActive: boolean;
}

export interface TOCProgress {
  /** Current reading progress as percentage (0-100) */
  percentage: number;
  /** Index of currently active section */
  activeIndex: number;
  /** ID of currently active header */
  activeId: string | null;
}

export interface TOCConfig {
  /** Whether to show reading progress indicator */
  showProgress: boolean;
  /** Whether to use smooth scrolling */
  smoothScroll: boolean;
  /** Minimum number of headers required to show TOC */
  minHeaders: number;
  /** Header levels to include (default: [2, 3]) */
  includeLevels: number[];
  /** Offset for scroll position calculation (for fixed headers) */
  scrollOffset: number;
}

export interface TOCState {
  /** All sections in the table of contents */
  sections: TOCSection[];
  /** Current reading progress */
  progress: TOCProgress;
  /** Whether TOC is visible/expanded (mobile) */
  isVisible: boolean;
  /** Configuration options */
  config: TOCConfig;
}

export type TOCNavigationEvent = {
  /** The target header ID */
  targetId: string;
  /** The header text */
  headerText: string;
  /** Whether this was triggered by user interaction */
  userTriggered: boolean;
};
