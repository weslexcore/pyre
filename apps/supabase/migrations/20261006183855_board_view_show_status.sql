-- Whether a saved view names each card's status on its row.
--
-- A card's status is its column. On the board that is the column around the
-- card; in a view grouped by a month, a person, or a field, the only trace of
-- it was a coloured dot, which says the column's name only on hover. So a view
-- now chooses: show the column by name beside the dot (the default), or show
-- neither, for a view where the column is noise.

alter table public.board_views
  add column show_status boolean not null default true;

comment on column public.board_views.show_status is
  'Whether each card''s row names its column (its status) in this view; off shows neither the name nor the dot.';
