export interface GiftCardData {
  /**
   * The redemption code the recipient enters at checkout, e.g. "PYRE-7K2M-Q9". Printed verbatim.
   * Leave it out to print "code:" with a blank line so the code can be written in by hand.
   */
  code?: string;
  /**
   * What the card is worth. A number prints as a dollar amount ("$50"); a string prints as-is,
   * so non-dollar values work too ("1 session", "4 credits"). Leave it out to print a dollar
   * sign and a blank line so the amount can be written in by hand.
   */
  value?: number | string;
  /** One line under the value. Defaults to "Heat, cold, connection." */
  lede?: string;
  /** Recipient name. Printed as "For {to}" on the back. */
  to?: string;
  /** Giver name. Printed as "From {from}" on the back. */
  from?: string;
  /** Optional expiry printed inside the code chip, e.g. "use by 12/31/2027". */
  expires?: string;
  /** Set as data-accent on both faces so a post can recolor cards per batch. */
  accent?: string;
}
