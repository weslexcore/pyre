import * as React from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "cta";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `cta` shows the animated brand gradient border. */
  variant?: ButtonVariant;
  /** Control height and padding. */
  size?: ButtonSize;
  /** Render as an anchor instead of a button when set. */
  href?: string;
  children?: React.ReactNode;
}

/**
 * Primary action control for the Pyre brand. Uppercase Fraktion Mono label,
 * four variants (primary/secondary/outline/cta) and three sizes.
 */
export function Button({
  variant = "primary",
  size = "md",
  href,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const cls = `pyre-btn pyre-btn--${size} pyre-btn--${variant} ${className}`.trim();
  if (href) {
    return (
      <a href={href} className={cls} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export default Button;
