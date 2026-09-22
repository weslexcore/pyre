-- A date question on a form can refuse a date that has already gone. The
-- question document grows a second optional flag beside `multiple`
-- (lib/boards/forms.ts): absent or false takes any date; true refuses
-- anything before today, read on the bathhouse's clock in New York so the
-- sender and the board agree on what "gone" means. Today itself counts as
-- still to come, so a request for tonight still sends.
--
-- Nothing changes in the table; this records the shape the column now holds.

comment on column public.board_forms.questions is
  'Ordered list of { kind, key, label, hint, required, multiple?, future? }; validated in the app against the board''s live fields. multiple: a date question takes more than one date. future: it refuses a date before today.';
