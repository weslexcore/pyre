import * as React from "react";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the control. */
  label?: string;
  /** Error message; also switches the input to its error styling. */
  error?: string;
}

/**
 * Labeled text field with brand focus ring and error state. Renders a
 * `<label>` + `<input>` pair styled in Pyre Neue Montreal Mono.
 */
export function Input({ label, error, className = "", id, ...rest }: InputProps) {
  const inputId = id || (label ? `pyre-input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className="pyre-field">
      {label ? (
        <label className="pyre-field__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={`pyre-input${error ? " pyre-input--error" : ""} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? <span className="pyre-field__error">{error}</span> : null}
    </div>
  );
}

export default Input;
