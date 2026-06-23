import * as React from "react";

export type EventCardVariant = "default" | "ink";

export interface EventImage {
  src: string;
  alt: string;
}

export interface EventCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Event name (rendered uppercase). */
  title: string;
  /** Short blurb; clamped to two lines. */
  description?: string;
  /** Human date label shown in the accent badge, e.g. "Sat, Jun 28". */
  date: string;
  /** Time label, e.g. "4:00 PM". */
  time: string;
  /** Venue / location label. */
  location: string;
  /** Optional cover image. */
  image?: EventImage;
  /** Remaining spots; drives the availability color and the CTA label. */
  spotsRemaining?: number;
  /** Total capacity (used to render "x of y spots"). */
  totalSpots?: number;
  /** Call-to-action label (defaults to "Book now"; "Join waitlist" when sold out). */
  ctaLabel?: string;
  /** Link target for the CTA. */
  href?: string;
  /** `ink` renders on the dark sauna ground. */
  variant?: EventCardVariant;
}

function ClockIcon() {
  return (
    <svg className="pyre-event__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg className="pyre-event__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg className="pyre-event__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

/** Availability tone: sold out → red, nearly full (≤3) → gold, otherwise muted. */
function spotsClass(spots?: number) {
  if (spots === 0) return "pyre-event__spots--sold";
  if (spots !== undefined && spots <= 3) return "pyre-event__spots--low";
  return "";
}
function spotsLabel(spotsRemaining?: number, totalSpots?: number) {
  if (spotsRemaining === undefined) return null;
  if (spotsRemaining === 0) return "Sold out";
  if (totalSpots) return `${spotsRemaining} of ${totalSpots} spots`;
  return `${spotsRemaining} spots left`;
}

/**
 * Event card from the Pyre events carousel: optional cover image, a date badge,
 * uppercase title, blurb, time/location/availability meta, and a CTA pill.
 * `ink` flips it onto the dark ground used on the events page.
 */
export function EventCard({
  title,
  description,
  date,
  time,
  location,
  image,
  spotsRemaining,
  totalSpots,
  ctaLabel = "Book now",
  href,
  variant = "default",
  className = "",
  ...rest
}: EventCardProps) {
  const spots = spotsLabel(spotsRemaining, totalSpots);
  const cta = spotsRemaining === 0 ? "Join waitlist" : ctaLabel;
  const mod = variant === "ink" ? " pyre-event-card--ink" : "";
  return (
    <article className={`pyre-event-card${mod} ${className}`.trim()} {...rest}>
      {image ? <img className="pyre-event-card__media" src={image.src} alt={image.alt} loading="lazy" /> : null}
      <div className="pyre-event-card__body">
        <span className="pyre-event-card__date">{date}</span>
        <h3 className="pyre-event-card__title">{title}</h3>
        {description ? <p className="pyre-event-card__desc">{description}</p> : null}
        <div className="pyre-event-card__meta">
          <span className="pyre-event__row">
            <ClockIcon />
            {time}
          </span>
          <span className="pyre-event__row">
            <PinIcon />
            {location}
          </span>
          {spots ? (
            <span className={`pyre-event__row ${spotsClass(spotsRemaining)}`.trim()}>
              <UsersIcon />
              {spots}
            </span>
          ) : null}
        </div>
        {href ? (
          <a className="pyre-event-card__cta" href={href}>
            {cta}
          </a>
        ) : (
          <span className="pyre-event-card__cta">{cta}</span>
        )}
      </div>
    </article>
  );
}

export default EventCard;
