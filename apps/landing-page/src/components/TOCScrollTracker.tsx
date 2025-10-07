/**
 * React island component for TOC scroll tracking and intersection observer functionality
 */

import type { TOCHeader, TOCSection, TOCConfig } from '../lib/toc-types';
import {
  extractHeadersFromDocument,
  buildTOCTree,
  flattenTOCTree,
  getCurrentActiveHeader,
  calculateReadingProgress,
  scrollToHeader,
  DEFAULT_TOC_CONFIG,
} from '../lib/toc-utils';

export default class TOCScrollTracker {
  private container: HTMLElement;
  private config: TOCConfig;
  private headers: TOCHeader[] = [];
  private sections: TOCSection[] = [];
  private flatSections: TOCSection[] = [];
  private intersectionObserver: IntersectionObserver | null = null;
  private scrollTimeout: number | null = null;
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

    const options = {
      rootMargin: `-${this.config.scrollOffset}px 0px -60% 0px`,
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
    // Scroll listener for progress tracking
    const handleScroll = () => {
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
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // Mobile toggle functionality
    const toggleBtn = this.container.querySelector('[data-toc-toggle]');
    const closeBtn = this.container.querySelector('[data-toc-close]');
    const backdrop = this.container.querySelector('[data-toc-backdrop]');
    const mobilePanel = this.container.querySelector('[data-toc-mobile-panel]');

    const openMobilePanel = () => {
      mobilePanel?.classList.add('open');
      backdrop?.classList.add('open');
      document.body.style.overflow = 'hidden';

      // Update ARIA attributes
      toggleBtn?.setAttribute('aria-expanded', 'true');
      mobilePanel?.setAttribute('aria-hidden', 'false');

      // Focus the close button for keyboard accessibility
      const closeButton = mobilePanel?.querySelector('[data-toc-close]') as HTMLElement;
      closeButton?.focus();
    };

    const closeMobilePanel = () => {
      mobilePanel?.classList.remove('open');
      backdrop?.classList.remove('open');
      document.body.style.overflow = '';

      // Update ARIA attributes
      toggleBtn?.setAttribute('aria-expanded', 'false');
      mobilePanel?.setAttribute('aria-hidden', 'true');

      // Return focus to toggle button
      toggleBtn?.focus();
    };

    toggleBtn?.addEventListener('click', openMobilePanel);
    closeBtn?.addEventListener('click', closeMobilePanel);
    backdrop?.addEventListener('click', closeMobilePanel);

    // Handle escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobilePanel?.classList.contains('open')) {
        closeMobilePanel();
      }
    });

    // TOC item click handlers
    this.container.addEventListener('click', (e) => {
      const tocLink = (e.target as HTMLElement).closest('[data-toc-item]');
      if (!tocLink) return;

      e.preventDefault();
      const headerId = tocLink.getAttribute('data-toc-item');
      if (!headerId) return;

      this.isUserScrolling = true;
      this.navigateToSection(headerId);

      // Close mobile panel after navigation
      if (window.innerWidth < 1024) {
        closeMobilePanel();
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

        // Close mobile panel after navigation
        if (window.innerWidth < 1024) {
          closeMobilePanel();
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
        <li class="toc-item level-${header.level}" data-level="${header.level}" role="listitem">
          <a
            href="#${header.id}"
            data-toc-item="${header.id}"
            class="toc-link"
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
    // Remove active class from all items
    const tocItems = this.container.querySelectorAll('.toc-item');
    tocItems.forEach((item) => {
      item.classList.remove('active');
    });

    // Add active class to current item
    const activeItems = this.container.querySelectorAll(`[data-toc-item="${activeId}"]`);
    activeItems.forEach((item) => {
      const tocItem = item.closest('.toc-item');
      tocItem?.classList.add('active');
    });

    // Update ARIA current
    const tocLinks = this.container.querySelectorAll('[data-toc-item]');
    tocLinks.forEach((link) => {
      link.removeAttribute('aria-current');
    });
    activeItems.forEach((item) => {
      item.setAttribute('aria-current', 'true');
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

    // Update active section based on current scroll position
    const activeId = getCurrentActiveHeader(this.headers, this.config.scrollOffset);
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

      await scrollToHeader(headerId, this.config.scrollOffset);

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
        const rect = element.getBoundingClientRect();
        const targetTop = rect.top + window.pageYOffset - this.config.scrollOffset;
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
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    // Remove event listeners would go here if we tracked them
    // For now, since they're bound to elements that get removed, they'll be cleaned up automatically
  }
}
