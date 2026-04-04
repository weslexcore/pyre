// React carousel component for testimonials
// Used as an Astro island with client:load directive

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TestimonialItem } from '@/lib/types';

interface TestimonialsCarouselProps {
  items: TestimonialItem[];
}

const CARD_WIDTH = 300;
const GAP = 16;
const SCROLL_AMOUNT = CARD_WIDTH + GAP;

function TestimonialCard({ testimonial }: { testimonial: TestimonialItem }) {
  return (
    <article
      className={`testimonial-card flex-shrink-0 w-[280px] md:w-[300px] snap-start rounded-lg p-6 transition-all duration-300 ${
        testimonial.highlight
          ? 'border border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/5 hover:border-[var(--pyre-gold)]/80'
          : 'border border-current/10 hover:border-current/30'
      }`}
    >
      <div
        className="flex justify-center gap-0.5 mb-3 text-[var(--pyre-gold)]"
        aria-label="5 out of 5 stars"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <svg key={i} className="w-4 h-4 fill-current" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
      <blockquote className="mb-4">
        <p className="italic leading-relaxed opacity-90">"{testimonial.quote}"</p>
      </blockquote>
      <footer>
        <cite className="not-italic">
          <span className="font-mono-bold text-sm block">{testimonial.name}</span>
        </cite>
      </footer>
    </article>
  );
}

export default function TestimonialsCarousel({ items }: TestimonialsCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
  }, []);

  const scroll = useCallback((direction: number) => {
    const container = scrollRef.current;
    if (!container) return;

    container.scrollBy({
      left: direction * SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  }, []);

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows, { passive: true });
    return () => window.removeEventListener('resize', updateArrows);
  }, [updateArrows]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items triggers arrow update when changed
  useEffect(() => {
    updateArrows();
  }, [items, updateArrows]);

  if (items.length === 0) return null;

  return (
    <div className="testimonials-wrapper relative">
      {/* Left scroll arrow */}
      <button
        type="button"
        onClick={() => scroll(-1)}
        className={`absolute left-0 md:-left-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center bg-[var(--pyre-black)] border border-current/20 rounded-full shadow-lg transition-all duration-300 hover:border-current/40 hover:scale-110 ${
          canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-label="Scroll left"
      >
        <svg
          className="w-5 h-5 md:w-6 md:h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Right scroll arrow */}
      <button
        type="button"
        onClick={() => scroll(1)}
        className={`absolute right-0 md:-right-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center bg-[var(--pyre-black)] border border-current/20 rounded-full shadow-lg transition-all duration-300 hover:border-current/40 hover:scale-110 ${
          canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-label="Scroll right"
      >
        <svg
          className="w-5 h-5 md:w-6 md:h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <div className="testimonials-container -mx-4 px-4 md:-mx-6 md:px-6">
        <div
          ref={scrollRef}
          onScroll={updateArrows}
          className="testimonials-scroll flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4"
          style={{
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}
        >
          {items.map((testimonial) => (
            <TestimonialCard key={testimonial.id} testimonial={testimonial} />
          ))}
        </div>
      </div>

      <style>{`
        .testimonials-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
