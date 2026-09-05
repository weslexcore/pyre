-- Lost & found: telling "we think this is theirs" apart from "they told us".
--
-- owner_email already existed, but it only ever meant a guess: staff matched a
-- face to a Momence member at the desk, and the next step was always an email
-- asking "did you leave this behind?". The case it couldn't record is the
-- easiest one there is — the guest emails us first, says they left their ring,
-- and someone goes and finds it. Emailing them to ask whether the ring they
-- just told us about is theirs is noise, and logging it as 'unclaimed' puts a
-- ring somebody is on their way to collect on the donation pile.
--
-- So the column is the difference between the two, and it is the guest's own
-- word that sets it: true means a person told us, in some channel we don't
-- store, that this is theirs. The route that sets it also moves the item to
-- 'claimed', which is what keeps the 30-day sweep off it — the sweep only ever
-- touches 'unclaimed'.
--
-- What it is deliberately NOT is claimed_by_*. Those columns stay the sole
-- property of the signed claim link: they mean "this address clicked a token
-- we minted", which is an attestation, and a staff form must not be able to
-- write one. owner_confirmed is the weaker, honest claim — a staff member says
-- the guest said so — and the audit trail records who typed it.

alter table public.lost_found_items
  add column if not exists owner_confirmed boolean not null default false;

comment on column public.lost_found_items.owner_confirmed is
  'The guest told us it is theirs (they reached out, or said so at the desk), so nobody needs to be emailed. Set by staff and audited as a claim_received event with their address as the actor — unlike claimed_by_*, which only the signed claim link may write.';
