# Google review card (print)

A single-sided 4×6in postcard asking guests to leave a Google review, with a QR code that opens the write-a-review form directly: <https://g.page/r/CbPLgfm6vte6EAI/review>.

## Export

```bash
yarn workspace @pyre/social render google-review-card
# → exports/google-review-card/review-card-4x6-bleed-1.png
```

## Print instructions

- The canvas is **1275×1875px = 4.25×6.25in at 300dpi**: a 4×6in trim size plus 0.125in bleed on every edge. Tell the print shop "trim to 4×6".
- All content sits at least 0.375in from the canvas edge (bleed + cutting tolerance), so nothing important is at risk in the cut.
- The PNG carries no DPI metadata (Playwright doesn't write it). Print shops size by pixel dimensions, but if one insists on metadata, run:
  `sips -s dpiHeight 300 -s dpiWidth 300 <png>`
- For a borderless home/office printer, print the PNG scaled to fill 4×6 paper instead.
- Before a large print run, print one draft at actual size and scan the QR with both an iPhone and an Android phone.

## QR code

`assets/review-qr.svg` is committed. Regenerate (e.g. if the review link changes) with:

```bash
yarn workspace @pyre/social generate-qr "https://g.page/r/CbPLgfm6vte6EAI/review" posts/google-review-card/assets/review-qr.svg
```

The SVG has no built-in quiet zone; the white panel's padding in `style.css` provides it. Keep that padding at or above 4 QR modules (~56px at the current 460px render size).
