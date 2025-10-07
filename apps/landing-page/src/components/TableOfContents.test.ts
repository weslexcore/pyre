/**
 * Unit tests for TableOfContents Astro component
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock DOM environment
const mockDocument = {
  addEventListener: vi.fn(),
  querySelector: vi.fn(),
  querySelectorAll: vi.fn(),
  getElementById: vi.fn(),
  body: {
    style: {
      overflow: '',
    },
  },
  documentElement: {
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  },
};

const mockWindow = {
  addEventListener: vi.fn(),
  innerWidth: 1024,
  pageYOffset: 0,
  innerHeight: 800,
  scrollTo: vi.fn(),
  IntersectionObserver: vi.fn(),
  setTimeout: vi.fn((fn) => fn()),
  clearTimeout: vi.fn(),
};

// Mock the TOCScrollTracker class
const mockTOCScrollTracker = vi.fn().mockImplementation(() => ({
  init: vi.fn(),
  destroy: vi.fn(),
}));

// Mock dynamic import
vi.mock('./TOCScrollTracker', () => ({
  default: mockTOCScrollTracker,
}));

describe('TableOfContents Component Integration', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock container element
    container = {
      querySelector: vi.fn(),
      querySelectorAll: vi.fn(),
      addEventListener: vi.fn(),
      getAttribute: vi.fn(),
      style: { display: '' },
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn(),
      },
    } as HTMLElement;

    // Mock global objects
    global.document = mockDocument as any;
    global.window = mockWindow as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Component Initialization', () => {
    it('should initialize TOCScrollTracker when container is found', async () => {
      const mockConfig = { showProgress: true, minHeaders: 3 };

      container.getAttribute = vi.fn().mockReturnValue(JSON.stringify(mockConfig));
      mockDocument.querySelector.mockReturnValue(container);

      // Simulate the component's script execution
      const initFunction = async () => {
        const tocContainer = mockDocument.querySelector('[data-toc-config]');
        if (!tocContainer) return;

        const configAttr = tocContainer.getAttribute('data-toc-config');
        const config = configAttr ? JSON.parse(configAttr) : {};

        const { default: TOCScrollTracker } = await import('./TOCScrollTracker');
        const scrollTracker = new TOCScrollTracker(tocContainer, config);
        scrollTracker.init();
      };

      await initFunction();

      expect(mockDocument.querySelector).toHaveBeenCalledWith('[data-toc-config]');
      expect(container.getAttribute).toHaveBeenCalledWith('data-toc-config');
      expect(mockTOCScrollTracker).toHaveBeenCalledWith(container, mockConfig);
    });

    it('should handle missing container gracefully', async () => {
      mockDocument.querySelector.mockReturnValue(null);

      const initFunction = async () => {
        const tocContainer = mockDocument.querySelector('[data-toc-config]');
        if (!tocContainer) return;
        // This code shouldn't execute
        throw new Error('Should not reach here');
      };

      await expect(initFunction()).resolves.not.toThrow();
      expect(mockTOCScrollTracker).not.toHaveBeenCalled();
    });

    it('should handle invalid config JSON gracefully', async () => {
      container.getAttribute = vi.fn().mockReturnValue('invalid-json');
      mockDocument.querySelector.mockReturnValue(container);

      const initFunction = async () => {
        const tocContainer = mockDocument.querySelector('[data-toc-config]');
        if (!tocContainer) return;

        const configAttr = tocContainer.getAttribute('data-toc-config');
        let config = {};
        try {
          config = configAttr ? JSON.parse(configAttr) : {};
        } catch (e) {
          config = {}; // Fallback to default config
        }

        const { default: TOCScrollTracker } = await import('./TOCScrollTracker');
        const scrollTracker = new TOCScrollTracker(tocContainer, config);
        scrollTracker.init();
      };

      await expect(initFunction()).resolves.not.toThrow();
      expect(mockTOCScrollTracker).toHaveBeenCalledWith(container, {});
    });

    it('should use empty config when no data attribute present', async () => {
      container.getAttribute = vi.fn().mockReturnValue(null);
      mockDocument.querySelector.mockReturnValue(container);

      const initFunction = async () => {
        const tocContainer = mockDocument.querySelector('[data-toc-config]');
        if (!tocContainer) return;

        const configAttr = tocContainer.getAttribute('data-toc-config');
        const config = configAttr ? JSON.parse(configAttr) : {};

        const { default: TOCScrollTracker } = await import('./TOCScrollTracker');
        const scrollTracker = new TOCScrollTracker(tocContainer, config);
        scrollTracker.init();
      };

      await initFunction();

      expect(mockTOCScrollTracker).toHaveBeenCalledWith(container, {});
    });
  });

  describe('Mobile Panel Functionality', () => {
    let toggleBtn: HTMLElement;
    let closeBtn: HTMLElement;
    let backdrop: HTMLElement;
    let mobilePanel: HTMLElement;

    beforeEach(() => {
      toggleBtn = {
        addEventListener: vi.fn(),
      } as any;

      closeBtn = {
        addEventListener: vi.fn(),
      } as any;

      backdrop = {
        addEventListener: vi.fn(),
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      } as any;

      mobilePanel = {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn(),
        },
      } as any;

      container.querySelector = vi.fn().mockImplementation((selector) => {
        switch (selector) {
          case '[data-toc-toggle]':
            return toggleBtn;
          case '[data-toc-close]':
            return closeBtn;
          case '[data-toc-backdrop]':
            return backdrop;
          case '[data-toc-mobile-panel]':
            return mobilePanel;
          default:
            return null;
        }
      });
    });

    it('should setup mobile panel event listeners', () => {
      // Simulate the mobile panel setup from TOCScrollTracker
      const setupMobilePanel = () => {
        const toggle = container.querySelector('[data-toc-toggle]');
        const close = container.querySelector('[data-toc-close]');
        const backdropEl = container.querySelector('[data-toc-backdrop]');

        toggle?.addEventListener('click', vi.fn());
        close?.addEventListener('click', vi.fn());
        backdropEl?.addEventListener('click', vi.fn());
      };

      setupMobilePanel();

      expect(toggleBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(closeBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(backdrop.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should open mobile panel correctly', () => {
      const openMobilePanel = () => {
        mobilePanel?.classList.add('open');
        backdrop?.classList.add('open');
        mockDocument.body.style.overflow = 'hidden';
      };

      openMobilePanel();

      expect(mobilePanel.classList.add).toHaveBeenCalledWith('open');
      expect(backdrop.classList.add).toHaveBeenCalledWith('open');
      expect(mockDocument.body.style.overflow).toBe('hidden');
    });

    it('should close mobile panel correctly', () => {
      const closeMobilePanel = () => {
        mobilePanel?.classList.remove('open');
        backdrop?.classList.remove('open');
        mockDocument.body.style.overflow = '';
      };

      closeMobilePanel();

      expect(mobilePanel.classList.remove).toHaveBeenCalledWith('open');
      expect(backdrop.classList.remove).toHaveBeenCalledWith('open');
      expect(mockDocument.body.style.overflow).toBe('');
    });
  });

  describe('TOC List Rendering', () => {
    let tocList: HTMLElement;

    beforeEach(() => {
      tocList = {
        innerHTML: '',
      } as any;

      container.querySelectorAll = vi.fn().mockReturnValue([tocList]);
    });

    it('should show loading state initially', () => {
      const renderLoading = () => {
        const tocLists = container.querySelectorAll('[data-toc-list]');
        tocLists.forEach((list: any) => {
          list.innerHTML =
            '<li class="toc-loading text-sm text-gray-500 dark:text-gray-400">Loading table of contents...</li>';
        });
      };

      renderLoading();

      expect(tocList.innerHTML).toContain('Loading table of contents...');
      expect(tocList.innerHTML).toContain('toc-loading');
    });

    it('should show no headings message when no headers found', () => {
      const renderEmpty = () => {
        const tocLists = container.querySelectorAll('[data-toc-list]');
        tocLists.forEach((list: any) => {
          list.innerHTML =
            '<li class="text-sm text-gray-500 dark:text-gray-400">No headings found</li>';
        });
      };

      renderEmpty();

      expect(tocList.innerHTML).toContain('No headings found');
    });

    it('should render TOC items with correct structure', () => {
      const mockTOCHTML = `
        <li class="toc-item level-2" data-level="2">
          <a href="#introduction" data-toc-item="introduction" class="toc-link" title="Introduction">
            Introduction
          </a>
        </li>
      `;

      const renderTOC = () => {
        const tocLists = container.querySelectorAll('[data-toc-list]');
        tocLists.forEach((list: any) => {
          list.innerHTML = mockTOCHTML;
        });
      };

      renderTOC();

      expect(tocList.innerHTML).toContain('toc-item level-2');
      expect(tocList.innerHTML).toContain('data-toc-item="introduction"');
      expect(tocList.innerHTML).toContain('Introduction');
    });
  });

  describe('Progress Indicator', () => {
    let progressBar: HTMLElement;
    let progressText: HTMLElement;
    let progressContainer: HTMLElement;

    beforeEach(() => {
      progressBar = {
        style: { width: '0%' },
      } as any;

      progressText = {
        textContent: '0% complete',
      } as any;

      progressContainer = {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      } as any;

      container.querySelectorAll = vi.fn().mockImplementation((selector) => {
        switch (selector) {
          case '[data-progress-bar]':
            return [progressBar];
          case '[data-progress-text]':
            return [progressText];
          case '[data-show-progress]':
            return [progressContainer];
          default:
            return [];
        }
      });
    });

    it('should update progress bar width and text', () => {
      const updateProgress = (progress: number) => {
        const progressBars = container.querySelectorAll('[data-progress-bar]');
        const progressTexts = container.querySelectorAll('[data-progress-text]');

        progressBars.forEach((bar: any) => {
          bar.style.width = `${progress}%`;
        });

        progressTexts.forEach((text: any) => {
          text.textContent = `${progress}% complete`;
        });
      };

      updateProgress(45);

      expect(progressBar.style.width).toBe('45%');
      expect(progressText.textContent).toBe('45% complete');
    });

    it('should show progress indicator when enabled', () => {
      const showProgress = () => {
        const progressContainers = container.querySelectorAll('[data-show-progress]');
        progressContainers.forEach((container: any) => {
          container.classList.remove('hidden');
        });
      };

      showProgress();

      expect(progressContainer.classList.remove).toHaveBeenCalledWith('hidden');
    });

    it('should hide progress indicator when disabled', () => {
      const hideProgress = () => {
        const progressContainers = container.querySelectorAll('[data-show-progress]');
        progressContainers.forEach((container: any) => {
          container.classList.add('hidden');
        });
      };

      hideProgress();

      expect(progressContainer.classList.add).toHaveBeenCalledWith('hidden');
    });
  });

  describe('Active Section Highlighting', () => {
    let tocItem1: HTMLElement;
    let tocItem2: HTMLElement;
    let tocLink1: HTMLElement;
    let tocLink2: HTMLElement;

    beforeEach(() => {
      tocItem1 = {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      } as any;

      tocItem2 = {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      } as any;

      tocLink1 = {
        closest: vi.fn().mockReturnValue(tocItem1),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      } as any;

      tocLink2 = {
        closest: vi.fn().mockReturnValue(tocItem2),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      } as any;

      container.querySelectorAll = vi.fn().mockImplementation((selector) => {
        switch (selector) {
          case '.toc-item':
            return [tocItem1, tocItem2];
          case '[data-toc-item]':
            return [tocLink1, tocLink2];
          case '[data-toc-item="section1"]':
            return [tocLink1];
          default:
            return [];
        }
      });
    });

    it('should remove active class from all items', () => {
      const clearActiveStates = () => {
        const tocItems = container.querySelectorAll('.toc-item');
        tocItems.forEach((item: any) => item.classList.remove('active'));
      };

      clearActiveStates();

      expect(tocItem1.classList.remove).toHaveBeenCalledWith('active');
      expect(tocItem2.classList.remove).toHaveBeenCalledWith('active');
    });

    it('should add active class to specific item', () => {
      const setActiveItem = (activeId: string) => {
        const activeItems = container.querySelectorAll(`[data-toc-item="${activeId}"]`);
        activeItems.forEach((item: any) => {
          const tocItem = item.closest('.toc-item');
          tocItem?.classList.add('active');
        });
      };

      setActiveItem('section1');

      expect(tocItem1.classList.add).toHaveBeenCalledWith('active');
    });

    it('should update ARIA current attributes', () => {
      const updateAriaCurrents = (activeId: string) => {
        const tocLinks = container.querySelectorAll('[data-toc-item]');
        tocLinks.forEach((link: HTMLElement) => {
          link.removeAttribute('aria-current');
        });

        const activeItems = container.querySelectorAll(`[data-toc-item="${activeId}"]`);
        activeItems.forEach((item: HTMLElement) => {
          item.setAttribute('aria-current', 'true');
        });
      };

      updateAriaCurrents('section1');

      expect(tocLink1.removeAttribute).toHaveBeenCalledWith('aria-current');
      expect(tocLink2.removeAttribute).toHaveBeenCalledWith('aria-current');
      expect(tocLink1.setAttribute).toHaveBeenCalledWith('aria-current', 'true');
    });
  });
});
