# Gift card (print)

Double-sided 3.5×2in gift cards built on `templates/gift-card/`. Give a card a **code** and a
**value** to print them, or leave either one off to get a blank line for writing it in by hand.
An empty entry (`{}`) prints a card with both lines blank.

## Make a batch

1. Edit `cards.data.ts`. One entry per card:

   ```ts
   { code: 'PYRE-7K2M-Q9', value: 50 }
   { code: 'PYRE-3XD8-LA', value: 100, to: 'Sam', from: 'Alex' }
   { code: 'PYRE-H4PT-2N', value: '4 credits', expires: 'use by 12/31/2027' }
   { code: 'PYRE-Q2VW-8C' }
   {}
   ```

   A numeric `value` prints as dollars (`$50`); a string prints as written. No `value` prints
   `$` followed by a ruled line, and no `code` prints `code:` followed by a ruled line, for
   hand-writing.

2. Preview: `yarn workspace @pyre/social dev`, open `http://localhost:5173/preview/`, pick
   `gift-card`. Odd pages are fronts, even pages are backs.

3. Export:

   ```bash
   yarn workspace @pyre/social render gift-card
   # → exports/gift-card/gift-card.png     (card 1 front)
   # → exports/gift-card/gift-card-2.png   (card 1 back)
   # → exports/gift-card/gift-card-3.png   (card 2 front)
   # → exports/gift-card/gift-card-4.png   (card 2 back) …
   ```

> **Before printing:** each code must exist as a gift card in Momence for the value shown.
> The card is only a carrier for the code; it has no value of its own.

## Print instructions

- The canvas is **1125×675px = 3.75×2.25in at 300dpi**: a 3.5×2in trim plus 0.125in bleed on
  every edge. Tell the print shop "trim to 3.5×2, double-sided", pairing each odd page with the
  even page after it.
- All content sits at least 0.25in from the canvas edge (bleed plus cutting tolerance).
- The PNG carries no DPI metadata. If a print shop insists on it, run
  `sips -s dpiHeight 300 -s dpiWidth 300 <png>`.
