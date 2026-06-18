import * as React from "react";

export type BadgeTone = "red" | "blue" | "gold" | "sage" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Brand color of the badge. Use `outline` for a quiet variant. */
  tone?: BadgeTone;
  children?: React.ReactNode;
}

/**
 * Small uppercase label for session types (Social, Silent, Guided), statuses,
 * and counts. Pill-shaped, Fraktion Mono.
 */
export function Badge({ tone = "red", className = "", children, ...rest }: BadgeProps) {
  return (
    <span className={`pyre-badge pyre-badge--${tone} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}

export default Badge;
