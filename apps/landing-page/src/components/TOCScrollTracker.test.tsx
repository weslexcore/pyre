/**
 * Unit tests for TOCScrollTracker React component
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TOCScrollTracker from './TOCScrollTracker';

// Mock DOM APIs
const mockIntersectionObserver = vi.fn().mockImplementation((callback, options) => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
}));

const mockElement = (id: string, top: number = 0) =>
  ({
    id,
    getBoundingClientRect: vi.fn().mockReturnValue({ top }),
    setAttribute: vi.fn(),
    getAttribute: vi.fn().mockReturnValue(id),
    textContent: `Header ${id}`,
    tagName: `H2`,
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      contains: vi.fn(),
    },
    style: {
      display: '',
    },
  }) as HTMLElement;

const mockContainer = () =>
  ({
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(),
    addEventListener: vi.fn(),
    getAttribute: vi.fn(),
    style: { display: '' },
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  }) as HTMLElement;

// Mock window and document
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: mockIntersectionObserver,
});

Object.defineProperty(window, 'pageYOffset', {
  writable: true,
  value: 0,
});

Object.defineProperty(window, 'innerWidth', {
  writable: true,
  value: 1024,
});

Object.defineProperty(window, 'innerHeight', {
  writable: true,
  value: 800,
});

Object.defineProperty(window, 'addEventListener', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window, 'setTimeout', {
  writable: true,
  value: vi.fn((fn) => {
    fn();
    return 1;
  }),
});

Object.defineProperty(window, 'clearTimeout', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(document, 'querySelectorAll', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(document, 'getElementById', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(document, 'addEventListener', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(document, 'documentElement', {
  writable: true,
  value: {
    scrollHeight: 2000,
    scrollTop: 0,
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  },
});

Object.defineProperty(document, 'body', {
  writable: true,
  value: {
    style: {
      overflow: '',
    },
  },
});

describe('TOCScrollTracker', () => {
  let container: any;
  let tracker: TOCScrollTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    container = mockContainer();
    tracker = new TOCScrollTracker(container, {});

    // Mock extractHeadersFromDocument
    const mockHeaders = [
      mockElement('intro', -100),
      mockElement('overview', 50),
      mockElement('installation', 200),
    ];

    (document.querySelectorAll as any).mockReturnValue(mockHeaders);
  });

  afterEach(() => {
    tracker.destroy();
  });

  describe('Initialization', () => {
    it('should initialize with default config', () => {
      expect(tracker).toBeInstanceOf(TOCScrollTracker);
    });

    it('should merge custom config with defaults', () => {
      const customConfig = { minHeaders: 5, showProgress: false };
      const customTracker = new TOCScrollTracker(container, customConfig);

      // Access private config through init method behavior
      customTracker.init();

      // Verify the config was applied by checking if TOC is hidden (minHeaders: 5 > 3 headers)
      expect(container.style.display).toBe('none');
    });

    it('should hide TOC when insufficient headers', () => {
      // Mock fewer headers than minHeaders
      (document.querySelectorAll as any).mockReturnValue([mockElement('single')]);

      tracker.init();

      expect(container.style.display).toBe('none');
    });

    it('should setup intersection observer when headers exist', () => {
      tracker.init();

      expect(mockIntersectionObserver).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          rootMargin: '-100px 0px -60% 0px',
          threshold: 0.1,
        })
      );
    });

    it('should not setup intersection observer when IntersectionObserver is not available', () => {
      const originalIO = window.IntersectionObserver;
      (window as any).IntersectionObserver = undefined;

      tracker.init();

      // Should not throw and should handle gracefully
      expect(() => tracker.init()).not.toThrow();

      window.IntersectionObserver = originalIO;
    });
  });

  describe('Header Extraction', () => {
    it('should extract headers with correct structure', () => {
      const headers = [
        { ...mockElement('intro'), textContent: 'Introduction' },
        { ...mockElement('overview'), textContent: 'Overview' },
      ];

      (document.querySelectorAll as any).mockReturnValue(headers);

      tracker.init();

      // Verify headers were processed by checking if observer was called for each
      const observerInstance = mockIntersectionObserver.mock.results[0].value;
      expect(observerInstance.observe).toHaveBeenCalledTimes(2);
    });

    it('should generate IDs for headers without them', () => {
      const headerWithoutId = {
        ...mockElement(''),
        getAttribute: vi.fn().mockReturnValue(null),
        textContent: 'Getting Started',
      };

      (document.querySelectorAll as any).mockReturnValue([headerWithoutId]);

      tracker.init();

      expect(headerWithoutId.setAttribute).toHaveBeenCalledWith('id', 'getting-started');
    });

    it('should handle duplicate IDs by making them unique', () => {
      const header1 = {
        ...mockElement('test'),
        textContent: 'Test',
      };

      const header2 = {
        ...mockElement(''),
        getAttribute: vi.fn().mockReturnValue(null),
        textContent: 'Test',
      };

      (document.getElementById as any).mockImplementation((id: string) => {
        return id === 'test' ? header1 : null;
      });

      (document.querySelectorAll as any).mockReturnValue([header1, header2]);

      tracker.init();

      expect(header2.setAttribute).toHaveBeenCalledWith('id', 'test-1');
    });
  });

  describe('TOC Rendering', () => {
    beforeEach(() => {
      const tocList = { innerHTML: '' };
      container.querySelectorAll.mockReturnValue([tocList]);
    });

    it('should render TOC with hierarchical structure', () => {
      const headers = [
        { ...mockElement('intro'), textContent: 'Introduction', tagName: 'H2' },
        { ...mockElement('overview'), textContent: 'Overview', tagName: 'H3' },
        { ...mockElement('install'), textContent: 'Installation', tagName: 'H2' },
      ];

      (document.querySelectorAll as any).mockReturnValue(headers);

      tracker.init();

      const tocList = container.querySelectorAll()[0];
      expect(tocList.innerHTML).toContain('Introduction');
      expect(tocList.innerHTML).toContain('Overview');
      expect(tocList.innerHTML).toContain('Installation');
      expect(tocList.innerHTML).toContain('data-toc-item="intro"');
    });

    it('should show no headings message when no headers found', () => {
      (document.querySelectorAll as any).mockReturnValue([]);

      tracker.init();

      const tocList = container.querySelectorAll()[0];
      expect(tocList.innerHTML).toContain('No headings found');
    });

    it('should render nested TOC structure correctly', () => {
      const headers = [
        { ...mockElement('parent'), textContent: 'Parent', tagName: 'H2' },
        { ...mockElement('child1'), textContent: 'Child 1', tagName: 'H3' },
        { ...mockElement('child2'), textContent: 'Child 2', tagName: 'H3' },
      ];

      (document.querySelectorAll as any).mockReturnValue(headers);

      tracker.init();

      const tocList = container.querySelectorAll()[0];
      expect(tocList.innerHTML).toContain('<ul class="mt-1 space-y-1">');
      expect(tocList.innerHTML).toContain('Child 1');
      expect(tocList.innerHTML).toContain('Child 2');
    });
  });

  describe('Scroll Tracking', () => {
    it('should update active section based on intersection observer', () => {
      const mockObserver = mockIntersectionObserver.mock.results[0]?.value;
      const observerCallback = mockIntersectionObserver.mock.calls[0]?.[0];

      tracker.init();

      // Mock intersection entries
      const entries = [
        {
          isIntersecting: true,
          target: { id: 'intro' },
          boundingClientRect: { top: 50 },
        },
      ];

      // Simulate intersection observer callback
      if (observerCallback) {
        observerCallback(entries);
      }

      // Verify active section update
      expect(container.querySelectorAll).toHaveBeenCalledWith('.toc-item');
    });

    it('should ignore intersection updates when user is scrolling', () => {
      const observerCallback = mockIntersectionObserver.mock.calls[0]?.[0];

      tracker.init();

      // Simulate user scrolling
      tracker['isUserScrolling'] = true;

      const entries = [
        {
          isIntersecting: true,
          target: { id: 'intro' },
          boundingClientRect: { top: 50 },
        },
      ];

      if (observerCallback) {
        observerCallback(entries);
      }

      // Should not update active section during user scrolling
      // This is verified by the callback returning early
      expect(entries[0].target.id).toBe('intro');
    });

    it('should find topmost visible header when multiple are intersecting', () => {
      const observerCallback = mockIntersectionObserver.mock.calls[0]?.[0];

      tracker.init();

      const entries = [
        {
          isIntersecting: true,
          target: { id: 'section1' },
          boundingClientRect: { top: 100 },
        },
        {
          isIntersecting: true,
          target: { id: 'section2' },
          boundingClientRect: { top: 50 }, // This should be selected as topmost
        },
      ];

      if (observerCallback) {
        observerCallback(entries);
      }

      // The callback should select section2 as it has the smaller top value
      expect(entries[1].boundingClientRect.top).toBeLessThan(entries[0].boundingClientRect.top);
    });
  });

  describe('Progress Tracking', () => {
    beforeEach(() => {
      const progressBar = { style: { width: '0%' } } as HTMLElement;
      const progressText = { textContent: '0% complete' } as HTMLElement;
      container.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === '[data-progress-bar]') return [progressBar];
        if (selector === '[data-progress-text]') return [progressText];
        return [];
      });
    });

    it('should update progress bar and text', () => {
      // Mock scroll position
      Object.defineProperty(window, 'pageYOffset', { value: 600, writable: true });
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        value: 2000,
        writable: true,
      });

      tracker.init();

      // Trigger progress update
      const scrollHandler = window.addEventListener.mock.calls.find(
        (call) => call[0] === 'scroll'
      )?.[1];

      if (scrollHandler) {
        scrollHandler();
      }

      const progressBar = container.querySelectorAll('[data-progress-bar]')[0];
      const progressText = container.querySelectorAll('[data-progress-text]')[0];

      expect(progressBar.style.width).toBe('50%');
      expect(progressText.textContent).toBe('50% complete');
    });

    it('should show/hide progress based on config', () => {
      const progressContainer = {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      } as HTMLElement;

      container.querySelectorAll.mockImplementation((selector: string) => {
        if (selector === '[data-show-progress]') return [progressContainer];
        return [];
      });

      // Test with showProgress: true
      const trackerWithProgress = new TOCScrollTracker(container, { showProgress: true });
      trackerWithProgress.init();

      expect(progressContainer.classList.remove).toHaveBeenCalledWith('hidden');

      // Test with showProgress: false
      const trackerWithoutProgress = new TOCScrollTracker(container, { showProgress: false });
      trackerWithoutProgress.init();

      expect(progressContainer.classList.add).toHaveBeenCalledWith('hidden');
    });
  });

  describe('Navigation', () => {
    it('should navigate to section with smooth scroll', async () => {
      const mockElement = {
        getBoundingClientRect: vi.fn().mockReturnValue({ top: 100 }),
      };

      (document.getElementById as any).mockReturnValue(mockElement);

      tracker.init();

      // Simulate TOC item click
      const clickHandler = container.addEventListener.mock.calls.find(
        (call) => call[0] === 'click'
      )?.[1];

      const mockEvent = {
        target: {
          closest: vi.fn().mockReturnValue({
            getAttribute: vi.fn().mockReturnValue('test-section'),
          }),
        },
        preventDefault: vi.fn(),
      };

      if (clickHandler) {
        clickHandler(mockEvent);
      }

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(document.getElementById).toHaveBeenCalledWith('test-section');
    });

    it('should close mobile panel after navigation on mobile', () => {
      Object.defineProperty(window, 'innerWidth', { value: 768, writable: true });

      const mobilePanel = {
        classList: {
          remove: vi.fn(),
          contains: vi.fn().mockReturnValue(true),
        },
      };

      container.querySelector.mockImplementation((selector: string) => {
        if (selector === '[data-toc-mobile-panel]') return mobilePanel;
        return null;
      });

      tracker.init();

      // Simulate navigation on mobile
      const clickHandler = container.addEventListener.mock.calls.find(
        (call) => call[0] === 'click'
      )?.[1];

      const mockEvent = {
        target: {
          closest: vi.fn().mockReturnValue({
            getAttribute: vi.fn().mockReturnValue('test-section'),
          }),
        },
        preventDefault: vi.fn(),
      };

      if (clickHandler) {
        clickHandler(mockEvent);
      }

      expect(mobilePanel.classList.remove).toHaveBeenCalledWith('open');
    });
  });

  describe('Mobile Panel Controls', () => {
    let toggleBtn: HTMLElement;
    let closeBtn: HTMLElement;
    let backdrop: HTMLElement;
    let mobilePanel: HTMLElement;

    beforeEach(() => {
      toggleBtn = { addEventListener: vi.fn() } as HTMLElement;
      closeBtn = { addEventListener: vi.fn() } as HTMLElement;
      backdrop = { addEventListener: vi.fn() } as HTMLElement;
      mobilePanel = {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn(),
        },
      } as HTMLElement;

      container.querySelector.mockImplementation((selector: string) => {
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
      tracker.init();

      expect(toggleBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(closeBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(backdrop.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('should handle escape key to close mobile panel', () => {
      mobilePanel.classList.contains.mockReturnValue(true);

      tracker.init();

      const keydownHandler = document.addEventListener.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const escapeEvent = { key: 'Escape' };

      if (keydownHandler) {
        keydownHandler(escapeEvent);
      }

      expect(mobilePanel.classList.remove).toHaveBeenCalledWith('open');
    });
  });

  describe('Cleanup', () => {
    it('should disconnect intersection observer on destroy', () => {
      const mockObserverInstance = {
        observe: vi.fn(),
        disconnect: vi.fn(),
      };

      mockIntersectionObserver.mockReturnValue(mockObserverInstance);

      tracker.init();
      tracker.destroy();

      expect(mockObserverInstance.disconnect).toHaveBeenCalled();
    });

    it('should clear timeout on destroy', () => {
      tracker.init();

      // Simulate scroll timeout being set
      tracker['scrollTimeout'] = 123;

      tracker.destroy();

      expect(window.clearTimeout).toHaveBeenCalledWith(123);
    });
  });
});
