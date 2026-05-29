import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import review, {
  REVIEW_SURVEY_PLACEHOLDER,
  REVIEW_URL_PLACEHOLDER,
} from '@/lib/review';

type Branch = 'idle' | 'promoter' | 'detractor' | 'fallback';
type Rating = 1 | 2 | 3 | 4 | 5;

// PostHog is loaded only in production (main.astro gates it on import.meta.env.PROD).
// In dev, window.posthog is undefined, the survey watchdog trips after 4s, and the
// flow falls through to the email fallback branch. This is expected dev-mode behavior.
interface PostHog {
  capture: (event: string, props?: Record<string, unknown>) => void;
  renderSurvey: (surveyId: string, selector: string) => void;
}

declare global {
  interface Window {
    posthog?: PostHog;
  }
}

function track(event: string, props?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.capture(event, props);
  }
}

const SURVEY_WATCHDOG_MS = 4000;
const MOUNT_ID = 'pyre-feedback-mount';

export default function ReviewFlow() {
  const [branch, setBranch] = useState<Branch>('idle');
  const [rating, setRating] = useState<Rating | 0>(0);
  const [hover, setHover] = useState<Rating | 0>(0);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const starsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const events = review.posthog.events;
  const googleConfigured =
    review.urls.google && review.urls.google !== REVIEW_URL_PLACEHOLDER;
  const yelpConfigured =
    review.urls.yelp && review.urls.yelp !== REVIEW_URL_PLACEHOLDER;
  const surveyConfigured =
    review.posthog.surveyId && review.posthog.surveyId !== REVIEW_SURVEY_PLACEHOLDER;

  useEffect(() => {
    track(events.pageViewed);
  }, [events.pageViewed]);

  const clearSurveyMount = useCallback(() => {
    if (mountRef.current) {
      mountRef.current.innerHTML = '';
    }
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(() => clearSurveyMount, [clearSurveyMount]);

  const handleChangeRating = useCallback(() => {
    track(events.ratingChanged, { from: rating });
    clearSurveyMount();
    setBranch('idle');
    setRating(0);
    setHover(0);
  }, [events.ratingChanged, rating, clearSurveyMount]);

  const handleSubmit = useCallback(() => {
    if (rating === 0) return;
    track(events.ratingSubmitted, { rating });

    if (rating >= review.threshold) {
      setBranch('promoter');
      return;
    }

    if (!surveyConfigured) {
      track(events.surveyRenderFailed, { rating, reason: 'unconfigured' });
      setBranch('fallback');
      return;
    }

    setBranch('detractor');
    // Render the survey on the next tick so the mount node is in the DOM.
    requestAnimationFrame(() => {
      if (!mountRef.current) return;
      try {
        window.posthog?.renderSurvey(review.posthog.surveyId, `#${MOUNT_ID}`);
        track(events.surveyRendered, { rating });
      } catch {
        // fall through to watchdog
      }
      watchdogRef.current = window.setTimeout(() => {
        if (mountRef.current && mountRef.current.childElementCount === 0) {
          track(events.surveyRenderFailed, { rating, reason: 'no-render' });
          setBranch('fallback');
        }
      }, SURVEY_WATCHDOG_MS);
    });
  }, [
    rating,
    events.ratingSubmitted,
    events.surveyRendered,
    events.surveyRenderFailed,
    surveyConfigured,
  ]);

  const focusStar = useCallback((index: number) => {
    const el = starsRef.current[index];
    el?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = rating === 0 ? 1 : rating;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(5, current + 1) as Rating;
        setRating(next);
        focusStar(next - 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(1, current - 1) as Rating;
        setRating(next);
        focusStar(next - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setRating(1);
        focusStar(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setRating(5);
        focusStar(4);
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (rating > 0) {
          e.preventDefault();
          handleSubmit();
        }
      }
    },
    [rating, focusStar, handleSubmit],
  );

  const handlePlatformClick = (platform: 'google' | 'yelp', url: string) => {
    track(events.platformClicked, { platform, rating });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDetractorPublicClick = () => {
    track(events.detractorPublicLinkClicked, { rating });
  };

  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent('Pyre feedback');
    const body = encodeURIComponent(
      `Rating: ${rating || 'not given'} / 5\n\nWhat could have been better?\n\n`,
    );
    return `mailto:${review.fallbackEmail}?subject=${subject}&body=${body}`;
  }, [rating]);

  const handleFallbackClick = () => {
    track(events.fallbackClicked, { rating });
  };

  const stars: Rating[] = [1, 2, 3, 4, 5];
  const activeForDisplay = hover || rating;
  const focusableStar = rating === 0 ? 1 : rating;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className="border border-current/20 rounded-lg p-6 md:p-10 bg-[var(--pyre-creme)]/5 min-h-[24rem] md:min-h-[22rem]"
        aria-live="polite"
      >
        {branch === 'idle' && (
          <div className="text-center">
            <h2
              id="review-prompt"
              className="font-primary-semibold text-[clamp(1.25rem,3vw,1.75rem)] uppercase tracking-[-0.01em] mb-6"
            >
              {review.prompt}
            </h2>

            <div
              role="radiogroup"
              aria-labelledby="review-prompt"
              className="flex justify-center gap-2 sm:gap-3 mb-3 motion-safe:[&_svg]:transition-colors"
              onKeyDown={handleKeyDown}
              onMouseLeave={() => setHover(0)}
            >
              {stars.map((n, i) => {
                const filled = n <= activeForDisplay;
                const checked = rating === n;
                return (
                  <button
                    key={n}
                    ref={(el) => {
                      starsRef.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
                    tabIndex={n === focusableStar ? 0 : -1}
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHover(n)}
                    onFocus={() => setHover(n)}
                    onBlur={() => setHover(0)}
                    className="p-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-muted-gold)]"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className={`w-10 h-10 sm:w-12 sm:h-12 ${filled ? 'text-[var(--pyre-muted-gold)]' : 'text-current/30'}`}
                      fill={filled ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 2.5l2.95 6.55 7.05.74-5.3 4.84 1.5 7.12L12 17.95 5.8 21.75l1.5-7.12L2 9.79l7.05-.74L12 2.5z"
                      />
                    </svg>
                  </button>
                );
              })}
            </div>

            <p className="font-mono-bold text-xs uppercase tracking-wide opacity-70 h-5 mb-8">
              {activeForDisplay > 0 ? review.ratingLabels[activeForDisplay as Rating] : ' '}
            </p>

            <button
              type="button"
              disabled={rating === 0}
              onClick={handleSubmit}
              className="inline-flex items-center justify-center select-none font-mono-bold rounded-md font-semibold uppercase tracking-wide transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3 text-base border-2 border-transparent bg-[var(--primary)] text-[var(--pyre-creme)] hover:opacity-90"
            >
              {review.submitLabel}
            </button>
          </div>
        )}

        {branch === 'promoter' && (
          <div className="text-center">
            <h2 className="font-primary-semibold text-[clamp(1.5rem,3.5vw,2rem)] uppercase tracking-[-0.01em] mb-3">
              {review.promoter.headline}
            </h2>
            <p className="text-base md:text-lg opacity-80 max-w-md mx-auto mb-8">
              {review.promoter.body}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              {googleConfigured && (
                <button
                  type="button"
                  aria-label={review.promoter.googleCta.ariaLabel}
                  onClick={() => handlePlatformClick('google', review.urls.google)}
                  className="inline-flex items-center justify-center select-none font-mono-bold rounded-md font-semibold uppercase tracking-wide transition-colors duration-150 px-6 py-3 text-base border-2 border-transparent bg-[var(--primary)] text-[var(--pyre-creme)] hover:opacity-90"
                >
                  {review.promoter.googleCta.label}
                </button>
              )}
              {yelpConfigured && review.urls.yelp && (
                <button
                  type="button"
                  aria-label={review.promoter.yelpCta.ariaLabel}
                  onClick={() => handlePlatformClick('yelp', review.urls.yelp as string)}
                  className="inline-flex items-center justify-center select-none font-mono-bold rounded-md font-semibold uppercase tracking-wide transition-colors duration-150 px-6 py-3 text-base border-2 border-current text-current bg-transparent hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"
                >
                  {review.promoter.yelpCta.label}
                </button>
              )}
            </div>
            {!googleConfigured && (
              <p className="mt-6 text-xs opacity-60 italic">
                Review link coming soon — thank you for your support.
              </p>
            )}
            <button
              type="button"
              onClick={handleChangeRating}
              className="mt-8 text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
            >
              {review.changeRatingLabel}
            </button>
          </div>
        )}

        {branch === 'detractor' && (
          <div>
            <div className="text-center mb-6">
              <h2 className="font-primary-semibold text-[clamp(1.5rem,3.5vw,2rem)] uppercase tracking-[-0.01em] mb-3">
                {review.detractor.headline}
              </h2>
              <p className="text-base md:text-lg opacity-80 max-w-md mx-auto">
                {review.detractor.body}
              </p>
            </div>
            <div
              ref={mountRef}
              id={MOUNT_ID}
              className="min-h-[8rem]"
            />
            {googleConfigured && (
              <div className="mt-6 text-center">
                <a
                  href={review.urls.google}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={review.detractor.alsoPublicLink.ariaLabel}
                  onClick={handleDetractorPublicClick}
                  className="text-xs opacity-60 hover:opacity-100 underline underline-offset-4"
                >
                  {review.detractor.alsoPublicLink.label}
                </a>
              </div>
            )}
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={handleChangeRating}
                className="text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
              >
                {review.changeRatingLabel}
              </button>
            </div>
          </div>
        )}

        {branch === 'fallback' && (
          <div className="text-center">
            <h2 className="font-primary-semibold text-[clamp(1.5rem,3.5vw,2rem)] uppercase tracking-[-0.01em] mb-3">
              {review.fallback.headline}
            </h2>
            <p className="text-base md:text-lg opacity-80 max-w-md mx-auto mb-8">
              {review.fallback.body}
            </p>
            <a
              href={mailtoHref}
              aria-label={review.fallback.emailCta.ariaLabel}
              onClick={handleFallbackClick}
              className="inline-flex items-center justify-center select-none font-mono-bold rounded-md font-semibold uppercase tracking-wide transition-colors duration-150 px-6 py-3 text-base border-2 border-transparent bg-[var(--primary)] text-[var(--pyre-creme)] hover:opacity-90"
            >
              {review.fallback.emailCta.label}
            </a>
            <div className="mt-8">
              <button
                type="button"
                onClick={handleChangeRating}
                className="text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
              >
                {review.changeRatingLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
