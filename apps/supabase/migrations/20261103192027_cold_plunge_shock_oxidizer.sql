-- Each cold plunge can set its own weekly shock oxidizer dose.
--
-- The shock dose has been one chart amount (25 g at 120 gal), scaled to every
-- plunge by gallons / 120. Admins can now enter a plunge's own amount on
-- /admin/water/plunges. Null keeps the scaled default, so existing plunges
-- don't change.

alter table public.cold_plunges
  add column shock_oxidizer_grams numeric(6, 1)
    check (shock_oxidizer_grams is null or (shock_oxidizer_grams > 0 and shock_oxidizer_grams <= 1000));

comment on column public.cold_plunges.shock_oxidizer_grams is
  'Grams of oxidizer for this plunge''s weekly shock; null uses the 120 gal chart amount scaled by gallons / 120.';
