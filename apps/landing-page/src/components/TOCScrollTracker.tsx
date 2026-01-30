/**
 * React island component for TOC scroll tracking and intersection observer functionality
 */

import type { TOCConfig, TOCHeader, TOCSection } from '../lib/toc-types';
import { onScroll } from '../lib/scroll-coordinator';
import {
  buildTOCTree,
  calculateReadingProgress,
  calculateScrollOffset,
  DEFAULT_TOC_CONFIG,
  extractHeadersFromDocument,
  flattenTOCTree,
  getCurrentActiveHeader,
  scrollToHeader,
} from '../lib/toc-utils';

export default class TOCScrollTracker {
  private container: HTMLElement;
  private config: TOCConfig;
  private headers: TOCHeader[] = [];
  private sections: TOCSection[] = [];
  private flatSections: TOCSection[] = [];
  private intersectionObserver: IntersectionObserver | null = null;
  private scrollTimeout: number | null = null;
  private unsubscribeScroll: (() => void) | null = null;
  private isUserScrolling = false;

  constructor(container: HTMLElement, config: Partial<TOCConfig> = {}) {
    this.container = container;
    this.config = { ...DEFAULT_TOC_CONFIG, ...config };
  }

  init() {
    this.extractHeaders();
    this.setupIntersectionObserver();
    this.setupEventListeners();
    this.renderTOC();
    this.updateProgressVisibility();
  }

  private extractHeaders() {
    this.headers = extractHeadersFromDocument(this.config.includeLevels);

    // Only proceed if we have enough headers
    if (this.headers.length < this.config.minHeaders) {
      this.hideTOC();
      return;
    }

    this.sections = buildTOCTree(this.headers);
    this.flatSections = flattenTOCTree(this.sections);
  }

  private hideTOC() {
    this.container.style.display = 'none';
  }

  private setupIntersectionObserver() {
    if (!window.IntersectionObserver || this.headers.length === 0) return;

    // Use dynamic scroll offset for accurate mobile/desktop detection
    const dynamicOffset = calculateScrollOffset();

    const options = {
      rootMargin: `-${dynamicOffset}px 0px -60% 0px`,
      threshold: 0.1,
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      if (this.isUserScrolling) return;

      const visibleEntries = entries.filter((entry) => entry.isIntersecting);
      if (visibleEntries.length === 0) return;

      // Find the header closest to the top of the viewport
      const topEntry = visibleEntries.reduce((top, entry) => {
        const topY = Math.abs(top.boundingClientRect.top);
        const entryY = Math.abs(entry.boundingClientRect.top);
        return entryY < topY ? entry : top;
      });

      const activeId = topEntry.target.id;
      this.updateActiveSection(activeId);
    }, options);

    // Observe all header elements
    this.headers.forEach((header) => {
      if (header.element) {
        this.intersectionObserver!.observe(header.element);
      }
    });
  }

  private setupEventListeners() {
    // Scroll listener for progress tracking (via shared scroll coordinator)
    this.unsubscribeScroll = onScroll(() => {
      if (this.scrollTimeout) {
        clearTimeout(this.scrollTimeout);
      }

      this.scrollTimeout = window.setTimeout(() => {
        this.updateProgress();
        // Reset user scrolling flag after a longer delay to ensure navigation completes
        setTimeout(() => {
          this.isUserScrolling = false;
        }, 200);
      }, 100);
    });

    // Mobile accordion functionality
    const accordionToggle = this.container.querySelector('[data-toc-accordion-toggle]');
    const accordionContent = this.container.querySelector('[data-toc-accordion-content]');

    const toggleAccordion = () => {
      const isExpanded = accordionToggle?.getAttribute('aria-expanded') === 'true';

      if (isExpanded) {
        accordionContent?.classList.remove('open');
        accordionToggle?.setAttribute('aria-expanded', 'false');
        accordionContent?.setAttribute('aria-hidden', 'true');
      } else {
        accordionContent?.classList.add('open');
        accordionToggle?.setAttribute('aria-expanded', 'true');
        accordionContent?.setAttribute('aria-hidden', 'false');
      }
    };

    accordionToggle?.addEventListener('click', toggleAccordion);

    // TOC item click handlers
    this.container.addEventListener('click', (e) => {
      const tocLink = (e.target as HTMLElement).closest('[data-toc-item]');
      if (!tocLink) return;

      e.preventDefault();
      const headerId = tocLink.getAttribute('data-toc-item');
      if (!headerId) return;

      this.isUserScrolling = true;
      this.navigateToSection(headerId);

      // Close mobile accordion after navigation (optional)
      if (window.innerWidth < 1024 && accordionContent?.classList.contains('open')) {
        toggleAccordion();
      }
    });

    // Keyboard navigation support
    this.container.addEventListener('keydown', (e) => {
      const tocLink = (e.target as HTMLElement).closest('[data-toc-item]');
      if (!tocLink) return;

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const headerId = tocLink.getAttribute('data-toc-item');
        if (!headerId) return;

        this.isUserScrolling = true;
        this.navigateToSection(headerId);

        // Close mobile accordion after navigation (optional)
        if (window.innerWidth < 1024 && accordionContent?.classList.contains('open')) {
          toggleAccordion();
        }
      }
    });
  }

  private renderTOC() {
    const tocLists = this.container.querySelectorAll('[data-toc-list]');

    if (this.headers.length === 0) {
      tocLists.forEach((list) => {
        list.innerHTML =
          '<li class="text-sm text-gray-500 dark:text-gray-400">No headings found</li>';
      });
      return;
    }

    const tocHTML = this.renderTOCSections(this.sections);

    tocLists.forEach((list) => {
      list.innerHTML = tocHTML;
    });
  }

  private renderTOCSections(sections: TOCSection[], level = 2): string {
    return sections
      .map((section) => {
        const { header } = section;
        const hasChildren = section.children.length > 0;

        let html = `
        <li class="toc-item level-${header.level} transition-all duration-200 ${header.level === 3 ? 'ml-4' : ''} ${header.level === 4 ? 'ml-8' : ''} ${header.level === 5 ? 'ml-12' : ''} ${header.level === 6 ? 'ml-16' : ''}" data-level="${header.level}" role="listitem">
          <a
            href="#${header.id}"
            data-toc-item="${header.id}"
            class="block py-1 px-2 text-sm text-[rgb(38,37,37)] dark:text-gray-400 rounded transition-all duration-200 no-underline hover:bg-[rgb(36,90,130)]/10 hover:text-[rgb(36,90,130)] hover:translate-x-0.5 font-sans leading-[1.4]"
            title="Navigate to: ${header.text}"
            role="link"
            tabindex="0"
          >
            ${header.text}
          </a>
      `;

        if (hasChildren) {
          html += `<ul class="mt-1 space-y-1">${this.renderTOCSections(section.children, level + 1)}</ul>`;
        }

        html += '</li>';
        return html;
      })
      .join('');
  }

  private updateActiveSection(activeId: string) {
    // Remove active styles from all items and update ARIA
    const allLinks = this.container.querySelectorAll('[data-toc-item]');
    allLinks.forEach((link) => {
      link.classList.remove(
        'text-[rgb(241,88,54)]',
        'dark:text-[rgb(251,146,60)]',
        'bg-[rgb(241,88,54)]/10',
        'font-semibold',
        'border-l-[3px]',
        'border-[rgb(241,88,54)]',
        'pl-[calc(0.5rem-3px)]'
      );
      link.classList.add('pl-2');
      link.removeAttribute('aria-current');
    });

    // Add active styles to current item
    const activeLinks = this.container.querySelectorAll(`[data-toc-item="${activeId}"]`);
    activeLinks.forEach((link) => {
      link.classList.remove('pl-2');
      link.classList.add(
        'text-[rgb(241,88,54)]',
        'dark:text-[rgb(251,146,60)]',
        'bg-[rgb(241,88,54)]/10',
        'font-semibold',
        'border-l-[3px]',
        'border-[rgb(241,88,54)]',
        'pl-[calc(0.5rem-3px)]'
      );
      link.setAttribute('aria-current', 'true');
    });
  }

  private updateProgress() {
    const progress = calculateReadingProgress();
    const progressBars = this.container.querySelectorAll('[data-progress-bar]');
    const progressTexts = this.container.querySelectorAll('[data-progress-text]');

    progressBars.forEach((bar) => {
      const barElement = bar as HTMLElement;
      barElement.style.width = `${progress}%`;
      barElement.setAttribute('aria-valuenow', progress.toString());
    });

    progressTexts.forEach((text) => {
      text.textContent = `${progress}% complete`;
    });

    // Update active section based on current scroll position using dynamic offset
    const activeId = getCurrentActiveHeader(this.headers);
    if (activeId) {
      this.updateActiveSection(activeId);
    }
  }

  private updateProgressVisibility() {
    const progressContainers = this.container.querySelectorAll('[data-show-progress]');

    if (this.config.showProgress) {
      progressContainers.forEach((container) => {
        container.classList.remove('hidden');
      });
    } else {
      progressContainers.forEach((container) => {
        container.classList.add('hidden');
      });
    }
  }

  private async navigateToSection(headerId: string) {
    // Set user scrolling flag to prevent intersection observer interference
    this.isUserScrolling = true;

    // Update active section immediately when user clicks
    this.updateActiveSection(headerId);

    if (this.config.smoothScroll) {
      // Enable smooth scrolling temporarily
      document.documentElement.classList.add('smooth-scroll');

      // Use dynamic scroll offset for accurate mobile/desktop navigation
      await scrollToHeader(headerId);

      // Remove smooth scroll class after navigation
      setTimeout(() => {
        document.documentElement.classList.remove('smooth-scroll');
        // Update active section again after scroll completes
        this.updateActiveSection(headerId);
        // Reset user scrolling flag after longer delay
        setTimeout(() => {
          this.isUserScrolling = false;
        }, 300);
      }, 500);
    } else {
      const element = document.getElementById(headerId);
      if (element) {
        // Use dynamic scroll offset for accurate mobile/desktop navigation
        const dynamicOffset = calculateScrollOffset();
        const rect = element.getBoundingClientRect();
        const targetTop = rect.top + window.pageYOffset - dynamicOffset;
        window.scrollTo(0, targetTop);

        // Update active section after scroll
        setTimeout(() => {
          this.updateActiveSection(headerId);
          // Reset user scrolling flag
          this.isUserScrolling = false;
        }, 300);
      }
    }
  }

  destroy() {
    this.unsubscribeScroll?.();
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
  }
}
