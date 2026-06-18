import * as React from "react";
import { Badge, type BadgeTone } from "./Badge";
import { Squiggle } from "./Squiggle";

export type SessionType = "Social" | "Silent" | "Guided";

export interface SessionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Session format — drives the badge tone. */
  type: SessionType;
  /** Human-readable time label, e.g. "Sat · 4:00 PM". */
  time: string;
  /** Price label, e.g. "$45". */
  price: string;
  /** Remaining spots; shown as availability. */
  slotsLeft: number;
}

const TONE: Record<SessionType, BadgeTone> = {
  Social: "red",
  Silent: "blue",
  Guided: "gold",
};

/**
 * Domain card for a bookable sauna session. Pairs the session type badge with
 * time, price, and live slot availability on the dark sauna ground.
 */
export function SessionCard({
  type,
  time,
  price,
  slotsLeft,
  className = "",
  ...rest
}: SessionCardProps) {
  return (
    <div className={`pyre-session ${className}`.trim()} {...rest}>
      <div className="pyre-session__head">
        <span className="pyre-session__type">{type}</span>
        <Badge tone={TONE[type]}>{type}</Badge>
      </div>
      <Squiggle />
      <span className="pyre-session__time">{time}</span>
      <div className="pyre-session__meta">
        <span className="pyre-session__price">{price}</span>
        <span className="pyre-session__slots">
          {slotsLeft > 0 ? `${slotsLeft} spots left` : "Sold out"}
        </span>
      </div>
    </div>
  );
}

export default SessionCard;
