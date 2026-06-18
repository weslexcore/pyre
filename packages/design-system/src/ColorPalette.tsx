import * as React from "react";

export interface Swatch {
  name: string;
  value: string;
}

export interface ColorPaletteProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Swatches to display. Defaults to the full Pyre brand palette. */
  swatches?: Swatch[];
}

const BRAND: Swatch[] = [
  { name: "Red", value: "#d15232" },
  { name: "Blue", value: "#274868" },
  { name: "Gold", value: "#dbb155" },
  { name: "Sage", value: "#839770" },
  { name: "Sky", value: "#3991b7" },
  { name: "Black", value: "#23221c" },
  { name: "Creme", value: "#f5f1e9" },
];

/**
 * Foundation reference: the Pyre brand color palette rendered as labeled
 * swatches with hex values. Pass `swatches` to show a custom set.
 */
export function ColorPalette({ swatches = BRAND, className = "", ...rest }: ColorPaletteProps) {
  return (
    <div className={`pyre-palette ${className}`.trim()} {...rest}>
      {swatches.map((s) => (
        <div className="pyre-swatch" key={s.name}>
          <div className="pyre-swatch__chip" style={{ background: s.value }} />
          <span className="pyre-swatch__name">{s.name}</span>
          <span className="pyre-swatch__hex">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

export default ColorPalette;
