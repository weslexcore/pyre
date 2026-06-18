import * as React from "react";

export interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Wordmark font size in pixels. */
  size?: number;
  /** Override the wordmark text (defaults to PYRE). */
  children?: React.ReactNode;
}

/**
 * The Pyre wordmark set in the Eckmannpsych display face. Inherits color from
 * its context — place on creme or ink grounds.
 */
export function Logo({ size = 40, className = "", children = "PYRE", style, ...rest }: LogoProps) {
  return (
    <span
      className={`pyre-logo ${className}`.trim()}
      style={{ fontSize: size, ...style }}
      {...rest}
    >
      {children}
    </span>
  );
}

export default Logo;
