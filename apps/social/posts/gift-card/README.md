# Gift card (print)

A blank double-sided 3.5×2in gift card built on `templates/gift-card/`. The back has a `$` with a
full-width ruled line for the amount and a `code:` label with a ruled line for the code, both to
be filled in by hand. Print as many copies as needed.

## Export

```bash
yarn workspace @pyre/social render gift-card
# → exports/gift-card/gift-card.png     (front)
# → exports/gift-card/gift-card-2.png   (back)
```

Preview: `yarn workspace @pyre/social dev`, open `http://localhost:5173/preview/`, pick `gift-card`.

## Pre-printing a value or code

`cards.data.ts` holds a single empty entry (`{}`). To print the amount or code instead of leaving
a line, add them there; one entry per card, two pages per entry:

```ts
export const cards: GiftCardData[] = [
  {},                                       // blank amount and code
  { value: 50 },                            // "$50" printed, code hand-written
  { code: 'PYRE-7K2M-Q9', value: 100 },     // both printed
];
```

> **Before handing one out:** the code written on the card must exist as a gift card in Momence
> for the amount written. The card is only a carrier for the code.

## Print instructions

- The canvas is **1125×675px = 3.75×2.25in at 300dpi**: a 3.5×2in trim plus 0.125in bleed on
  every edge. Tell the print shop "trim to 3.5×2, double-sided".
- All content sits at least 0.25in from the canvas edge (bleed plus cutting tolerance).
- The PNG carries no DPI metadata. If a print shop insists on it, run
  `sips -s dpiHeight 300 -s dpiWidth 300 <png>`.
- The creme back takes pen well; use a fine black or dark blue marker so the amount and code
  stay legible at card size.
