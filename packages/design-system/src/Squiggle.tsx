import * as React from "react";

export interface SquiggleProps {
  /** Stroke height in pixels. */
  height?: number;
  /** Gradient start color (defaults to brand red). */
  from?: string;
  /** Gradient end color (defaults to brand gold). */
  to?: string;
}

// One period of the Pyre divider wave, repeated across a 0–300 viewBox.
const WAVE =
  "M0,5 Q7.5,1 15,5 T30,5 T45,5 T60,5 T75,5 T90,5 T105,5 T120,5 T135,5 " +
  "T150,5 T165,5 T180,5 T195,5 T210,5 T225,5 T240,5 T255,5 T270,5 T285,5 T300,5";

/**
 * The Pyre squiggle — the brand's hand-drawn divider wave, used under card
 * headers. Internal brand element (not a standalone export); renders a
 * full-width red→gold gradient stroke.
 */
export function Squiggle({
  height = 10,
  from = "var(--pyre-red)",
  to = "var(--pyre-gold)",
}: SquiggleProps) {
  const id = React.useId();
  return (
    <svg
      className="pyre-squiggle"
      viewBox="0 0 300 10"
      width="100%"
      height={height}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <path d={WAVE} stroke={`url(#${id})`} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default Squiggle;
