/**
 * Unit tests for TOC utility functions
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TOCHeader, TOCSection } from './toc-types';
import {
  buildTOCTree,
  calculateReadingProgress,
  DEFAULT_TOC_CONFIG,
  extractHeadersFromContent,
  flattenTOCTree,
  generateAnchorId,
  getCurrentActiveHeader,
  scrollToHeader,
} from './toc-utils';

// Mock DOM APIs
Object.defineProperty(window, 'DOMParser', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    parseFromString: vi.fn().mockReturnValue({
      querySelectorAll: vi.fn().mockReturnValue([]),
    }),
  })),
});

Object.defineProperty(window, 'pageYOffset', {
  writable: true,
  value: 0,
});

Object.defineProperty(window, 'innerHeight', {
  writable: true,
  value: 800,
});

Object.defineProperty(document, 'documentElement', {
  writable: true,
  value: {
    scrollTop: 0,
    scrollHeight: 2000,
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  },
});

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

describe('generateAnchorId', () => {
  it('should convert text to URL-safe anchor ID', () => {
    expect(generateAnchorId('Hello World')).toBe('hello-world');
    expect(generateAnchorId('Getting Started with React')).toBe('getting-started-with-react');
    expect(generateAnchorId('API Reference & Examples')).toBe('api-reference-examples');
  });

  it('should handle special characters', () => {
    expect(generateAnchorId('What is React?')).toBe('what-is-react');
    expect(generateAnchorId('Section 1.2.3')).toBe('section-123');
    expect(generateAnchorId('User@email.com')).toBe('useremailcom');
  });

  it('should handle edge cases', () => {
    expect(generateAnchorId('')).toBe('');
    expect(generateAnchorId('   ')).toBe('');
    expect(generateAnchorId('---')).toBe('');
    expect(generateAnchorId('a')).toBe('a');
  });

  it('should remove leading and trailing hyphens', () => {
    expect(generateAnchorId('-test-')).toBe('test');
    expect(generateAnchorId('--test--')).toBe('test');
  });

  it('should collapse multiple spaces/hyphens', () => {
    expect(generateAnchorId('hello    world')).toBe('hello-world');
    expect(generateAnchorId('test---case')).toBe('test-case');
  });
});

describe('extractHeadersFromContent', () => {
  it('should extract headers from HTML content', () => {
    const mockDoc = {
      querySelectorAll: vi.fn().mockReturnValue([
        {
          textContent: 'Introduction',
          tagName: 'H2',
          getAttribute: vi.fn().mockReturnValue('intro'),
        },
        {
          textContent: 'Getting Started',
          tagName: 'H2',
          getAttribute: vi.fn().mockReturnValue(null),
        },
        {
          textContent: 'Installation',
          tagName: 'H3',
          getAttribute: vi.fn().mockReturnValue('install'),
        },
      ]),
    };

    const mockParser = {
      parseFromString: vi.fn().mockReturnValue(mockDoc),
    };

    (window.DOMParser as any).mockImplementation(() => mockParser);

    const headers = extractHeadersFromContent(
      '<h2 id="intro">Introduction</h2><h2>Getting Started</h2><h3 id="install">Installation</h3>'
    );

    expect(headers).toHaveLength(3);
    expect(headers[0]).toEqual({
      id: 'intro',
      text: 'Introduction',
      level: 2,
    });
    expect(headers[1]).toEqual({
      id: 'getting-started',
      text: 'Getting Started',
      level: 2,
    });
    expect(headers[2]).toEqual({
      id: 'install',
      text: 'Installation',
      level: 3,
    });
  });

  it('should filter by included levels', () => {
    const mockDoc = {
      querySelectorAll: vi.fn().mockReturnValue([
        {
          textContent: 'H2 Header',
          tagName: 'H2',
          getAttribute: vi.fn().mockReturnValue('h2'),
        },
        {
          textContent: 'H3 Header',
          tagName: 'H3',
          getAttribute: vi.fn().mockReturnValue('h3'),
        },
        {
          textContent: 'H4 Header',
          tagName: 'H4',
          getAttribute: vi.fn().mockReturnValue('h4'),
        },
      ]),
    };

    const mockParser = {
      parseFromString: vi.fn().mockReturnValue(mockDoc),
    };

    (window.DOMParser as any).mockImplementation(() => mockParser);

    const headers = extractHeadersFromContent('<html></html>', [2, 4]);

    expect(mockDoc.querySelectorAll).toHaveBeenCalledWith('h2, h4');
  });

  it('should handle empty or invalid content', () => {
    const mockDoc = {
      querySelectorAll: vi.fn().mockReturnValue([]),
    };

    const mockParser = {
      parseFromString: vi.fn().mockReturnValue(mockDoc),
    };

    (window.DOMParser as any).mockImplementation(() => mockParser);

    const headers = extractHeadersFromContent('');
    expect(headers).toHaveLength(0);
  });
});

describe('buildTOCTree', () => {
  it('should build hierarchical tree from flat headers', () => {
    const headers: TOCHeader[] = [
      { id: 'intro', text: 'Introduction', level: 2 },
      { id: 'overview', text: 'Overview', level: 3 },
      { id: 'features', text: 'Features', level: 3 },
      { id: 'installation', text: 'Installation', level: 2 },
      { id: 'requirements', text: 'Requirements', level: 3 },
    ];

    const tree = buildTOCTree(headers);

    expect(tree).toHaveLength(2);
    expect(tree[0].header.text).toBe('Introduction');
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].header.text).toBe('Overview');
    expect(tree[0].children[1].header.text).toBe('Features');

    expect(tree[1].header.text).toBe('Installation');
    expect(tree[1].children).toHaveLength(1);
    expect(tree[1].children[0].header.text).toBe('Requirements');
  });

  it('should handle single level headers', () => {
    const headers: TOCHeader[] = [
      { id: 'section1', text: 'Section 1', level: 2 },
      { id: 'section2', text: 'Section 2', level: 2 },
    ];

    const tree = buildTOCTree(headers);

    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[1].children).toHaveLength(0);
  });

  it('should handle deeply nested headers', () => {
    const headers: TOCHeader[] = [
      { id: 'h2', text: 'H2', level: 2 },
      { id: 'h3', text: 'H3', level: 3 },
      { id: 'h4', text: 'H4', level: 4 },
      { id: 'h5', text: 'H5', level: 5 },
    ];

    const tree = buildTOCTree(headers);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].children).toHaveLength(1);
  });
});

describe('flattenTOCTree', () => {
  it('should flatten hierarchical tree to flat array', () => {
    const tree: TOCSection[] = [
      {
        header: { id: 'intro', text: 'Introduction', level: 2 },
        children: [
          {
            header: { id: 'overview', text: 'Overview', level: 3 },
            children: [],
            isActive: false,
          },
        ],
        isActive: false,
      },
      {
        header: { id: 'install', text: 'Installation', level: 2 },
        children: [],
        isActive: false,
      },
    ];

    const flattened = flattenTOCTree(tree);

    expect(flattened).toHaveLength(3);
    expect(flattened[0].header.text).toBe('Introduction');
    expect(flattened[1].header.text).toBe('Overview');
    expect(flattened[2].header.text).toBe('Installation');
  });
});

describe('getCurrentActiveHeader', () => {
  const mockHeaders: TOCHeader[] = [
    {
      id: 'header1',
      text: 'Header 1',
      level: 2,
      element: {
        getBoundingClientRect: vi.fn().mockReturnValue({ top: -100 }),
      } as any,
    },
    {
      id: 'header2',
      text: 'Header 2',
      level: 2,
      element: {
        getBoundingClientRect: vi.fn().mockReturnValue({ top: 50 }),
      } as any,
    },
  ];

  beforeEach(() => {
    Object.defineProperty(window, 'pageYOffset', { value: 200, writable: true });
    Object.defineProperty(document.documentElement, 'scrollTop', { value: 200, writable: true });
  });

  it('should return active header ID based on scroll position', () => {
    const activeId = getCurrentActiveHeader(mockHeaders, 100);
    expect(activeId).toBe('header1');
  });

  it('should return null for empty headers', () => {
    const activeId = getCurrentActiveHeader([], 100);
    expect(activeId).toBeNull();
  });

  it('should handle headers without elements', () => {
    const headersWithoutElements: TOCHeader[] = [{ id: 'header1', text: 'Header 1', level: 2 }];

    const activeId = getCurrentActiveHeader(headersWithoutElements, 100);
    expect(activeId).toBeNull();
  });
});

describe('calculateReadingProgress', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'pageYOffset', { value: 0, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000,
      writable: true,
    });
  });

  it('should calculate progress percentage correctly', () => {
    Object.defineProperty(window, 'pageYOffset', { value: 600, writable: true });
    const progress = calculateReadingProgress();
    expect(progress).toBe(50); // (600 / (2000 - 800)) * 100 = 50
  });

  it('should return 0 at top of page', () => {
    Object.defineProperty(window, 'pageYOffset', { value: 0, writable: true });
    const progress = calculateReadingProgress();
    expect(progress).toBe(0);
  });

  it('should return 100 at bottom of page', () => {
    Object.defineProperty(window, 'pageYOffset', { value: 1200, writable: true });
    const progress = calculateReadingProgress();
    expect(progress).toBe(100);
  });

  it('should handle edge case where scroll height is too small', () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 400, writable: true });
    const progress = calculateReadingProgress();
    expect(progress).toBe(100);
  });
});

describe('scrollToHeader', () => {
  const mockElement = {
    getBoundingClientRect: vi.fn().mockReturnValue({ top: 100 }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'getElementById', {
      value: vi.fn().mockReturnValue(mockElement),
      writable: true,
    });
    Object.defineProperty(window, 'pageYOffset', { value: 200, writable: true });
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
  });

  it('should scroll to header with offset', async () => {
    await scrollToHeader('test-header', 50);

    expect(document.getElementById).toHaveBeenCalledWith('test-header');
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 250, // 100 (rect.top) + 200 (pageYOffset) - 50 (offset)
      behavior: 'smooth',
    });
  });

  it('should handle non-existent element', async () => {
    (document.getElementById as any).mockReturnValue(null);

    await scrollToHeader('non-existent', 50);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe('DEFAULT_TOC_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_TOC_CONFIG).toEqual({
      showProgress: true,
      smoothScroll: true,
      minHeaders: 2,
      includeLevels: [2, 3],
      scrollOffset: 100,
    });
  });
});
