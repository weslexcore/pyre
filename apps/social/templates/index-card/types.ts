/** One line of the card's ledger — e.g. an ingredient, its amount and a short tag. */
export interface IndexCardRow {
  label: string;
  /** Right-aligned amount, e.g. "3 drops". */
  value: string;
  /** Optional pill at the end of the row, e.g. "Top". Also set as data-tag for per-tag styling. */
  tag?: string;
}

export interface IndexCardData {
  /** Small red mono label above the title, e.g. "Uplifting · 01". */
  eyebrow: string;
  title: string;
  /** One-line description under the title. */
  lede?: string;
  rows: IndexCardRow[];
  /** Left side of the ruled footer, e.g. "8 drops total". */
  footnote?: string;
  /** Set as data-accent on the card so posts can color cards by group. */
  accent?: string;
}
