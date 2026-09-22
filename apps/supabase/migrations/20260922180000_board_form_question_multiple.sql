-- A date question on a form can take several dates, or one. The question
-- document grows an optional `multiple` flag (lib/boards/forms.ts): absent
-- or false, the form shows one date picker and keeps one date; true, it
-- offers "Add another date" the way the card drawer does. Nothing changes
-- in the table; this records the shape the column now holds.

comment on column public.board_forms.questions is
  'Ordered list of { kind, key, label, hint, required, multiple? }; validated in the app against the board''s live fields. multiple: a date question takes more than one date.';
