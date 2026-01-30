/**
 * Scroll Coordinator
 *
 * Registers a single `scroll` event listener on `window` and batches all
 * subscriber callbacks into one `requestAnimationFrame` callback per frame.
 * Auto-attaches when the first subscriber joins, auto-detaches when the last leaves.
 */

export interface ScrollData {
	scrollY: number;
	innerHeight: number;
}

type ScrollCallback = (data: ScrollData) => void;

const subscribers = new Set<ScrollCallback>();
let ticking = false;

function onFrame() {
	const data: ScrollData = {
		scrollY: window.scrollY,
		innerHeight: window.innerHeight,
	};
	for (const cb of subscribers) {
		cb(data);
	}
	ticking = false;
}

function handleScroll() {
	if (!ticking) {
		requestAnimationFrame(onFrame);
		ticking = true;
	}
}

/**
 * Subscribe to scroll updates. Returns an unsubscribe function.
 * The listener is added when the first subscriber joins and
 * removed when the last subscriber leaves.
 */
export function onScroll(callback: ScrollCallback): () => void {
	subscribers.add(callback);
	if (subscribers.size === 1) {
		window.addEventListener("scroll", handleScroll, { passive: true });
	}
	return () => {
		subscribers.delete(callback);
		if (subscribers.size === 0) {
			window.removeEventListener("scroll", handleScroll);
			ticking = false;
		}
	};
}

/** Read current scroll values without subscribing. */
export function getScrollData(): ScrollData {
	return {
		scrollY: window.scrollY,
		innerHeight: window.innerHeight,
	};
}
