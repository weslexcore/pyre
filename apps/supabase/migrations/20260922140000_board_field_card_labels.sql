-- Preserve the current label-and-value display unless a board opts out.
alter table public.board_fields
  add column show_label_on_card boolean not null default true;

comment on column public.board_fields.show_label_on_card is
  'Include the field label beside its value when show_on_card is enabled.';
