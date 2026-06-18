import * as React from "react";
import { Squiggle } from "./Squiggle";

export type CardVariant = "default" | "ink" | "elevated" | "gradient";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `ink` inverts to the dark sauna palette; `elevated` adds a soft shadow;
   * `gradient` wraps the card in the brand conic-gradient border.
   */
  variant?: CardVariant;
  /** Optional heading rendered at the top of the card. */
  heading?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Generic surface container with the Pyre creme/ink palette and brand radius.
 * Pass `heading` for a quick header, or compose freely via children.
 */
export function Card({
  variant = "default",
  heading,
  className = "",
  children,
  ...rest
}: CardProps) {
  const mod = variant === "default" ? "" : ` pyre-card--${variant}`;
  return (
    <div className={`pyre-card${mod} ${className}`.trim()} {...rest}>
      {heading ? (
        <div className="pyre-card__header">
          <h3 className="pyre-card__title">{heading}</h3>
          <Squiggle />
        </div>
      ) : null}
      {children ? <div className="pyre-card__body">{children}</div> : null}
    </div>
  );
}

export default Card;
