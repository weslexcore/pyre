/**
 * Utility functions for table of contents functionality
 */

import type { TOCHeader, TOCSection, TOCConfig } from './toc-types';

/**
 * Generates a URL-safe anchor ID from header text
 */
export function generateAnchorId(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Extracts headers from HTML content and returns TOC data
 */
export function extractHeadersFromContent(
  content: string,
  includeLevels: number[] = [2, 3]
): TOCHeader[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');

  const headerSelectors = includeLevels.map((level) => `h${level}`).join(', ');
  const headerElements = doc.querySelectorAll(headerSelectors);

  const headers: TOCHeader[] = [];

  headerElements.forEach((element) => {
    const text = element.textContent?.trim() || '';
    if (!text) return;

    const level = parseInt(element.tagName.substring(1));
    let id = element.getAttribute('id');

    // Generate ID if not present
    if (!id) {
      id = generateAnchorId(text);
      // Ensure uniqueness
      const existingIds = headers.map((h) => h.id);
      let counter = 1;
      let uniqueId = id;
      while (existingIds.includes(uniqueId)) {
        uniqueId = `${id}-${counter}`;
        counter++;
      }
      id = uniqueId;
    }

    headers.push({
      id,
      text,
      level,
    });
  });

  return headers;
}

/**
 * Extracts headers from the current document
 */
export function extractHeadersFromDocument(includeLevels: number[] = [2, 3]): TOCHeader[] {
  const headerSelectors = includeLevels.map((level) => `h${level}`).join(', ');
  const headerElements = document.querySelectorAll(headerSelectors);

  const headers: TOCHeader[] = [];

  headerElements.forEach((element) => {
    const text = element.textContent?.trim() || '';
    if (!text) return;

    const level = parseInt(element.tagName.substring(1));
    let id = element.getAttribute('id');

    // Generate ID if not present and set it on the element
    if (!id) {
      id = generateAnchorId(text);
      // Ensure uniqueness
      const existingIds = headers.map((h) => h.id);
      let counter = 1;
      let uniqueId = id;
      while (existingIds.includes(uniqueId) || document.getElementById(uniqueId)) {
        uniqueId = `${id}-${counter}`;
        counter++;
      }
      id = uniqueId;
      element.setAttribute('id', id);
    }

    headers.push({
      id,
      text,
      level,
      element: element as HTMLElement,
    });
  });

  return headers;
}

/**
 * Builds a hierarchical tree structure from flat header list
 */
export function buildTOCTree(headers: TOCHeader[]): TOCSection[] {
  const tree: TOCSection[] = [];
  const stack: TOCSection[] = [];

  for (const header of headers) {
    const section: TOCSection = {
      header,
      children: [],
      isActive: false,
    };

    // Find the correct parent level
    while (stack.length > 0 && stack[stack.length - 1].header.level >= header.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Top level section
      tree.push(section);
    } else {
      // Add as child to the last item in stack
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  return tree;
}

/**
 * Flattens a TOC tree back to a flat array of sections
 */
export function flattenTOCTree(tree: TOCSection[]): TOCSection[] {
  const flattened: TOCSection[] = [];

  function traverse(sections: TOCSection[]) {
    for (const section of sections) {
      flattened.push(section);
      if (section.children.length > 0) {
        traverse(section.children);
      }
    }
  }

  traverse(tree);
  return flattened;
}

/**
 * Gets the currently visible header based on scroll position
 */
export function getCurrentActiveHeader(
  headers: TOCHeader[],
  scrollOffset: number = 100
): string | null {
  if (headers.length === 0) return null;

  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const viewportHeight = window.innerHeight;

  // Find the header that's currently in view
  for (let i = headers.length - 1; i >= 0; i--) {
    const header = headers[i];
    if (!header.element) continue;

    const rect = header.element.getBoundingClientRect();
    const absoluteTop = rect.top + scrollTop;

    // Check if header is above the scroll offset line
    if (absoluteTop <= scrollTop + scrollOffset) {
      return header.id;
    }
  }

  // If no header is above the offset, return the first one if we're near the top
  if (scrollTop < scrollOffset && headers[0]) {
    return headers[0].id;
  }

  return null;
}

/**
 * Calculates reading progress as percentage
 */
export function calculateReadingProgress(): number {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;

  if (scrollHeight <= 0) return 100;

  const progress = Math.min(100, Math.max(0, (scrollTop / scrollHeight) * 100));
  return Math.round(progress);
}

/**
 * Smoothly scrolls to a target element
 */
export function scrollToHeader(headerId: string, offset: number = 100): Promise<void> {
  return new Promise((resolve) => {
    const element = document.getElementById(headerId);
    if (!element) {
      resolve();
      return;
    }

    const rect = element.getBoundingClientRect();
    const targetTop = rect.top + window.pageYOffset - offset;

    window.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    });

    // Resolve after scroll completes (estimate)
    setTimeout(resolve, 300);
  });
}

/**
 * Default TOC configuration
 */
export const DEFAULT_TOC_CONFIG: TOCConfig = {
  showProgress: true,
  smoothScroll: true,
  minHeaders: 2,
  includeLevels: [2, 3],
  scrollOffset: 100,
};
