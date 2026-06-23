import * as React from "react";

export interface EventRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Event name (rendered uppercase). */
  title: string;
  /** Time label, e.g. "Sat · 4:00 PM". */
  time: string;
  /** Remaining spots; drives availability color. */
  spotsRemaining?: number;
  /** Total capacity. */
  totalSpots?: number;
  /** CTA label (defaults to "Book"). */
  ctaLabel?: string;
  /** Link target for the CTA. */
  href?: string;
}

function ClockIcon() {
  return (
    <svg className="pyre-event__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
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

function spotsClass(spots?: number) {
  if (spots === 0) return "pyre-event__spots--sold";
  if (spots !== undefined && spots <= 3) return "pyre-event__spots--low";
  return "";
}
function spotsLabel(spotsRemaining?: number, totalSpots?: number) {
  if (spotsRemaining === undefined) return null;
  if (spotsRemaining === 0) return "Sold out";
  if (totalSpots) return `${spotsRemaining} of ${totalSpots}`;
  return `${spotsRemaining} spots`;
}

/**
 * A single row in the Pyre events-page schedule: title, time, availability, and
 * a book CTA, laid out horizontally for the dark, date-grouped event list.
 * Designed for the ink ground — group several under a date heading.
 */
export function EventRow({
  title,
  time,
  spotsRemaining,
  totalSpots,
  ctaLabel = "Book",
  href,
  className = "",
  ...rest
}: EventRowProps) {
  const spots = spotsLabel(spotsRemaining, totalSpots);
  return (
    <div className={`pyre-event-row ${className}`.trim()} {...rest}>
      <span className="pyre-event-row__title">{title}</span>
      <span className="pyre-event-row__time">
        <ClockIcon />
        {time}
      </span>
      {spots ? (
        <span className={`pyre-event-row__spots ${spotsClass(spotsRemaining)}`.trim()}>
          <UsersIcon />
          {spots}
        </span>
      ) : null}
      {href ? (
        <a className="pyre-event-row__cta" href={href}>
          {spotsRemaining === 0 ? "Waitlist" : ctaLabel}
        </a>
      ) : (
        <span className="pyre-event-row__cta">{spotsRemaining === 0 ? "Waitlist" : ctaLabel}</span>
      )}
    </div>
  );
}

export default EventRow;
