/**
 * Image Preloader Script
 *
 * Uses IntersectionObserver to detect images 500px before they enter the viewport
 * and triggers eager loading by removing the lazy loading attribute.
 * Works with Astro's view transitions.
 */

function initImagePreloader() {
  // Only run in browser
  if (typeof window === 'undefined') return;

  // Find all images with preload priority or lazy loading
  const preloadableImages = document.querySelectorAll<HTMLImageElement>(
    'img[data-preload-priority], img[loading="lazy"]'
  );

  if (preloadableImages.length === 0) return;

  // Create observer with 500px margin below viewport
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;

          // Remove lazy loading to trigger immediate load
          if (img.loading === 'lazy') {
            img.loading = 'eager';
          }

          // If image has a srcset, force browser to re-evaluate
          if (img.srcset) {
            const srcset = img.srcset;
            img.srcset = '';
            img.srcset = srcset;
          }

          // If image hasn't started loading, trigger it
          if (!img.complete && img.src) {
            const src = img.src;
            img.src = '';
            img.src = src;
          }

          // Stop observing this image
          observer.unobserve(img);
        }
      });
    },
    {
      // Trigger 500px before image enters viewport
      rootMargin: '0px 0px 500px 0px',
      threshold: 0,
    }
  );

  // Sort images by priority (lower number = higher priority)
  const sortedImages = Array.from(preloadableImages).sort((a, b) => {
    const priorityA = parseInt(a.dataset.preloadPriority || '999', 10);
    const priorityB = parseInt(b.dataset.preloadPriority || '999', 10);
    return priorityA - priorityB;
  });

  // Observe all images
  sortedImages.forEach((img) => {
    observer.observe(img);
  });

  // Return cleanup function
  return () => {
    observer.disconnect();
  };
}

// Initialize on first load
let cleanup: (() => void) | undefined;

function setup() {
  if (cleanup) {
    cleanup();
  }
  cleanup = initImagePreloader();
}

// Defer to idle so the main-thread cost of querying every lazy image and
// re-evaluating srcsets stays out of the LCP / TTI critical path.
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};
function scheduleSetup() {
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(setup, { timeout: 2000 });
  } else {
    setTimeout(setup, 200);
  }
}

if (document.readyState === 'complete') {
  scheduleSetup();
} else {
  window.addEventListener('load', scheduleSetup, { once: true });
}

// Re-initialize after Astro view transitions
document.addEventListener('astro:page-load', scheduleSetup);
