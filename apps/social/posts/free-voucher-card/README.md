# 15% off voucher card (print)

A double-sided 3.5×2in business card offering BFT members 15% off sauna + cold plunge with
promo code **BFT15**, plus a QR code to <https://pyresauna.com> (UTM-tagged
`qr / qr / bft-15 / voucher-card-15` so scans show up in PostHog web analytics).

> **Before printing:** the `BFT15` code must actually exist as a discount code in Momence.
> If a different code is used, change it in `index.html` (`.code__value`) and re-export.

## Export

```bash
yarn workspace @pyre/social render voucher-15-off
# → exports/voucher-15-off/voucher-card-bleed.png    (front)
# → exports/voucher-15-off/voucher-card-bleed-2.png  (back)
```

## Print instructions

- The canvas is **1125×675px = 3.75×2.25in at 300dpi**: a 3.5×2in trim size plus 0.125in bleed
  on every edge. Tell the print shop "trim to 3.5×2, double-sided" (page 1 front, page 2 back).
- All content sits at least 0.25in from the canvas edge (bleed + cutting tolerance), so nothing
  important is at risk in the cut.
- The PNG carries no DPI metadata (Playwright doesn't write it). Print shops size by pixel
  dimensions, but if one insists on metadata, run:
  `sips -s dpiHeight 300 -s dpiWidth 300 <png>`
- Before a large print run, print one draft at actual size and scan the QR with both an iPhone
  and an Android phone.

## QR code

The card uses `assets/pyre-qr-bft-15-qr-qr-voucher-card-15.png`, a styled QR (Pyre mark in the
center) encoding
`https://pyresauna.com/?utm_source=qr&utm_medium=qr&utm_campaign=bft-15&utm_content=voucher-card-15`.
It sits borderless on the creme card, which is light enough to act as the quiet zone.

A plain fallback (`assets/voucher-qr.svg`, older `15-off` UTM campaign) can be regenerated with:

```bash
yarn workspace @pyre/social generate-qr "<url>" posts/voucher-15-off/assets/voucher-qr.svg
```
