import * as React from "react";

export type HeadingLevel = 1 | 2 | 3 | 4;

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Semantic + visual level (1 largest). */
  level?: HeadingLevel;
  /** Small uppercase kicker rendered above the heading. */
  eyebrow?: string;
  children?: React.ReactNode;
}

/**
 * Section heading in the Pyre type system, set in Neue Montreal. `eyebrow` adds
 * a red mono kicker. (The Eckmannpsych display face is reserved for the PYRE
 * wordmark only — use the `Logo` component for that.)
 */
export function Heading({
  level = 2,
  eyebrow,
  className = "",
  children,
  ...rest
}: HeadingProps) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
  const cls = `pyre-heading pyre-heading--${level} ${className}`.trim();
  return (
    <>
      {eyebrow ? <div className="pyre-eyebrow">{eyebrow}</div> : null}
      <Tag className={cls} {...rest}>
        {children}
      </Tag>
    </>
  );
}

export default Heading;
