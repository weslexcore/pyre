-- Water testing log, chlorine clarity + test method:
--
-- 1. chlorine_ppm -> free_chlorine_ppm. FC is the active sanitizer — what
--    strips report and what the 1-3 ppm target and 5 ppm hard limit refer to.
--    Renamed so nobody logs a total-chlorine reading into it by mistake.
-- 2. combined_chlorine_ppm (CC): spent sanitizer (chloramines), computed as
--    total minus free on strips with both pads. High CC (> ~0.5 ppm) means
--    the tub is due for a shock.
-- 3. test_method: how the readings were taken.

alter table public.water_tests
  rename column chlorine_ppm to free_chlorine_ppm;

-- The check constraint kept its auto-generated name through the rename;
-- rename it to match the column.
alter table public.water_tests
  rename constraint water_tests_chlorine_ppm_check to water_tests_free_chlorine_ppm_check;

alter table public.water_tests
  add column combined_chlorine_ppm numeric
    check (combined_chlorine_ppm >= 0 and combined_chlorine_ppm <= 50);

alter table public.water_tests
  add column test_method text
    check (test_method in ('strips', 'digital_meter', 'tf_pro_salt'));
