-- Dashboard-built email journeys.
--
-- Until now each journey was TypeScript in apps/integrations
-- (src/lib/email/journeys/definitions/*.ts) and only its on/off switch lived
-- here (journey_settings). Every new journey, timing change or copy edit
-- needed a deploy. This moves the journey itself into the database so it can
-- be created, edited, switched on and off, and watched from /admin/journeys.
--
--   * journeys            — one row per journey. `definition` is the whole
--                            journey as one jsonb document (trigger, enroll /
--                            exit conditions, re-entry rule, steps with their
--                            timing, skip conditions, actions and email
--                            content). The app validates it with zod
--                            (src/lib/email/journeys/schema.ts) on every save;
--                            the database only checks that it is an object.
--                            What a journey can DO (the condition, trigger and
--                            merge-field catalogs) stays in code.
--   * enabled / test_mode — off pauses a journey (no new enrollments, nobody
--                            advances). Test mode limits it to the email
--                            whitelist, for walking a draft end to end.
--   * revision            — bumped on every save; the save is compare-and-
--                            swap on it, so two admins can't silently
--                            overwrite each other.
--   * journey_revisions   — a full snapshot per save (the sops/sop_versions
--                            pattern), for history and diffs.
--
-- journey_enrollments changes:
--   * current_step_key    — the step waiting to run, by its stable key rather
--                            than its position (the old `step` index), so
--                            reordering or archiving steps never moves
--                            someone onto the wrong email. `step` is left in
--                            place, unused, until a later cleanup.
--   * cycle               — re-entry. A journey with a cooldown can enroll the
--                            same person again once their last run ended long
--                            enough ago; each run is a new row with the next
--                            cycle. unique(journey_id, member_id) becomes
--                            unique(journey_id, member_id, cycle), plus a
--                            partial unique index so a member can never be in
--                            two active runs of the same journey (two webhook
--                            deliveries racing).
--   * anchor_at           — what step timing counts from: the booked
--                            session's end for booking-triggered journeys,
--                            otherwise the enrollment time.
--   * context             — how they entered (session id / booking id /
--                            session times, last known intro expiry). Never
--                            business state — that is always re-read live
--                            from Momence before a send.
--   * last_step_at        — when the previous step ran, for steps timed from
--                            the previous email.
--   * ended_at            — when the run completed or exited (cooldowns count
--                            from here).
--
-- email_sends changes: the subject actually sent, the journey revision that
-- produced it, and delivery / open / click / bounce times stamped by the
-- Resend webhook (looked up by resend_id, hence the index) so the dashboard
-- can show who received what.
--
-- Seed: the two code journeys (post-intro-offer, review-request) are
-- converted with their existing step keys, so every send key
-- (journey:{id}:{member}:{step}) stays the same and nobody gets a repeat.
-- Their on/off state carries over from journey_settings, which stays in place
-- (unused) until a later cleanup. Three new journeys are added switched off
-- and in test mode, with starter copy to edit from the dashboard:
-- intro-to-membership, win-back-30-days and intro-offer-pitch.

-- --- journeys ---

create table public.journeys (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  name text not null check (length(btrim(name)) > 0 and char_length(name) <= 80),
  enabled boolean not null default false,
  test_mode boolean not null default true,
  archived boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.journeys is
  'Dashboard-built email journeys; definition is validated by the integrations app (src/lib/email/journeys/schema.ts).';

alter table public.journeys enable row level security;

-- Reads and writes go through the integrations service (service role); the
-- policy only lets admins inspect the table directly.
create policy "admins can select journeys"
  on public.journeys for select
  to authenticated
  using (public.is_admin());

create trigger journeys_set_updated_at
  before update on public.journeys
  for each row execute function public.set_updated_at();

grant all on table public.journeys to service_role;

-- --- journey_revisions ---

create table public.journey_revisions (
  id uuid primary key default gen_random_uuid(),
  journey_id text not null references public.journeys (id) on delete cascade,
  revision integer not null check (revision > 0),
  name text not null,
  definition jsonb not null,
  edited_by text,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (journey_id, revision)
);

alter table public.journey_revisions enable row level security;

create policy "admins can select journey revisions"
  on public.journey_revisions for select
  to authenticated
  using (public.is_admin());

grant all on table public.journey_revisions to service_role;

-- --- journey_enrollments ---

alter table public.journey_enrollments
  add column current_step_key text,
  add column cycle integer not null default 0 check (cycle >= 0),
  add column anchor_at timestamptz,
  add column context jsonb not null default '{}'::jsonb,
  add column last_step_at timestamptz,
  add column ended_at timestamptz;

-- Position -> key for the two converted journeys. Rows already past the last
-- step have no key (the engine completes them).
update public.journey_enrollments
set current_step_key = case
    when journey_id = 'post-intro-offer' then (array['how-was-it', 'credit-pack', 'membership'])[step + 1]
    when journey_id = 'review-request' then (array['ask'])[step + 1]
  end
where status = 'active';

update public.journey_enrollments set anchor_at = enrolled_at;

update public.journey_enrollments
set ended_at = updated_at
where status <> 'active';

alter table public.journey_enrollments
  drop constraint journey_enrollments_journey_id_member_id_key;

alter table public.journey_enrollments
  add constraint journey_enrollments_journey_member_cycle_key unique (journey_id, member_id, cycle);

create unique index journey_enrollments_one_active_idx
  on public.journey_enrollments (journey_id, member_id)
  where status = 'active';

create index journey_enrollments_journey_idx
  on public.journey_enrollments (journey_id, enrolled_at desc);

-- --- email_sends ---

alter table public.email_sends
  add column subject text,
  add column journey_revision integer,
  add column delivered_at timestamptz,
  add column opened_at timestamptz,
  add column clicked_at timestamptz,
  add column bounced_at timestamptz;

create index email_sends_resend_id_idx
  on public.email_sends (resend_id)
  where resend_id is not null;

-- --- seed ---

insert into public.journeys (id, name, enabled, test_mode, definition)
values (
  'post-intro-offer',
  'Post-intro offer (original)',
  coalesce((select s.enabled from public.journey_settings s where s.journey_id = 'post-intro-offer'), true),
  false,
  $json${
  "description": "The original code-defined journey: credit pack then membership pitch after a first booking. Replaced by \"Intro to membership\".",
  "trigger": {
    "type": "session-booked",
    "firstBookingOnly": true
  },
  "enrollIf": [],
  "exitIf": [
    {
      "type": "has-non-intro-purchase",
      "negate": false
    }
  ],
  "reentry": {
    "mode": "once"
  },
  "onEnd": [],
  "steps": [
    {
      "key": "how-was-it",
      "name": "How was it?",
      "archived": false,
      "timing": {
        "anchor": "previous",
        "offsetHours": 72
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "template",
        "key": "intro-follow-up"
      }
    },
    {
      "key": "credit-pack",
      "name": "Credit pack pitch",
      "archived": false,
      "timing": {
        "anchor": "previous",
        "offsetHours": 168
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "template",
        "key": "credit-pack-pitch"
      }
    },
    {
      "key": "membership",
      "name": "Membership pitch",
      "archived": false,
      "timing": {
        "anchor": "previous",
        "offsetHours": 264
      },
      "skipIf": [
        {
          "type": "total-visits-at-least",
          "negate": true,
          "count": 2
        }
      ],
      "actions": [],
      "content": {
        "type": "template",
        "key": "membership-pitch"
      }
    }
  ]
}$json$::jsonb
);

insert into public.journeys (id, name, enabled, test_mode, definition)
values (
  'review-request',
  'Google review request',
  coalesce((select s.enabled from public.journey_settings s where s.journey_id = 'review-request'), true),
  false,
  $json${
  "description": "Asks regulars (4+ check-ins) for a Google review, once. Staff tag \"Google Review\" in Momence to exclude someone.",
  "trigger": {
    "type": "sweep",
    "minVisits": 4,
    "withTags": [],
    "withoutTags": [
      "Google Review",
      "Review Requested"
    ]
  },
  "enrollIf": [],
  "exitIf": [],
  "reentry": {
    "mode": "once"
  },
  "onEnd": [],
  "completionTag": "Review Requested",
  "steps": [
    {
      "key": "ask",
      "name": "Ask for a review",
      "archived": false,
      "timing": {
        "anchor": "previous",
        "offsetHours": 1
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "template",
        "key": "review-request"
      }
    }
  ]
}$json$::jsonb
);

insert into public.journeys (id, name, enabled, test_mode, definition)
values (
  'intro-to-membership',
  'Intro to membership',
  false,
  true,
  $json${
  "description": "After an intro-offer first session: the prorated membership offer, how members use Pyre, an expiry reminder, then a membership and credit pack offer once the intro runs out.",
  "trigger": {
    "type": "session-booked",
    "firstBookingOnly": true
  },
  "enrollIf": [
    {
      "type": "has-active-intro",
      "negate": false
    }
  ],
  "exitIf": [
    {
      "type": "has-active-membership",
      "negate": false
    }
  ],
  "reentry": {
    "mode": "once"
  },
  "onEnd": [],
  "steps": [
    {
      "key": "prorate-offer",
      "name": "Prorated membership offer",
      "archived": false,
      "timing": {
        "anchor": "trigger",
        "offsetHours": 4
      },
      "skipIf": [
        {
          "type": "attended-trigger-session",
          "negate": true
        }
      ],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "How was your first session, {{firstName|friend}}?",
        "preview": "Your intro counts toward a membership.",
        "background": "trees",
        "blocks": [
          {
            "type": "heading",
            "text": "How was it, {{firstName|friend}}?"
          },
          {
            "type": "paragraph",
            "text": "We hope you walked out lighter than you walked in. That feeling is what we built Pyre for, and it gets better the more often you come back.\n\nHere's something most people don't know: **if you switch to a membership while your intro offer is active, the $25 you paid for it comes off your first month.** You don't lose a thing by trying us first."
          },
          {
            "type": "list",
            "items": [
              "**Founding Unlimited - $199/month for life.** Come as often as you like, plus 4 guest passes a month and 10% off drinks and merch.",
              "**Founding Limited - $119/month.** 8 credits every month, 1 guest pass and 10% off drinks and merch."
            ]
          },
          {
            "type": "button",
            "label": "See memberships",
            "url": "https://pyresauna.com/#memberships"
          },
          {
            "type": "paragraph",
            "text": "Your second intro credit is still on your account - bring a friend or come back on your own."
          },
          {
            "type": "divider"
          },
          {
            "type": "paragraph",
            "text": "Questions about heat, cold, or which membership fits? Just reply - one of us will answer personally."
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    },
    {
      "key": "how-members-use-it",
      "name": "How members use Pyre",
      "archived": false,
      "timing": {
        "anchor": "trigger",
        "offsetHours": 168
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "How our members use Pyre",
        "preview": "Bike rides, long runs, dinner plans and early mornings.",
        "background": "clouds",
        "blocks": [
          {
            "type": "heading",
            "text": "How our members make it a habit"
          },
          {
            "type": "paragraph",
            "text": "{{firstName|Friend}}, a week ago you had your first session. Here's how the people who come every week fit Pyre into their lives:"
          },
          {
            "type": "list",
            "items": [
              "**The ride home.** Plan a long bike ride that ends at Pyre - heat for the legs, a cold plunge to reset.",
              "**Run, then recover.** Finish the long run, come in for a sweat and walk out feeling like you could do it again tomorrow.",
              "**Sauna, then dinner.** Meet a friend for a session and head out to eat - better than another drink at the bar.",
              "**Before work.** An early session clears the head before the inbox does."
            ]
          },
          {
            "type": "paragraph",
            "text": "A membership makes all of these easy: no math before each visit, guest passes to bring people along, and your intro offer still counts toward your first month."
          },
          {
            "type": "button",
            "label": "Find your membership",
            "url": "https://pyresauna.com/#memberships"
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    },
    {
      "key": "intro-expiring",
      "name": "Intro expires in 2 days",
      "archived": false,
      "timing": {
        "anchor": "intro-expiry",
        "offsetHours": -48
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "Your intro offer ends {{introExpiresOn|soon}}",
        "preview": "Switch now and your intro comes off your first month.",
        "background": "lamps",
        "blocks": [
          {
            "type": "heading",
            "text": "Two days left on your intro, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "Your intro offer expires on **{{introExpiresOn}}**. If you have a credit left, now is the time to use it.\n\nAnd if Pyre has started to feel like part of your week: switch to a membership before it expires and **the $25 you paid for the intro comes off your first month.**"
          },
          {
            "type": "list",
            "items": [
              "**Founding Unlimited - $199/month for life.** Come as often as you like, plus 4 guest passes a month and 10% off drinks and merch.",
              "**Founding Limited - $119/month.** 8 credits every month, 1 guest pass and 10% off drinks and merch."
            ]
          },
          {
            "type": "button",
            "label": "Claim a founding membership",
            "url": "https://momence.com/m/943595"
          },
          {
            "type": "paragraph",
            "text": "Prefer a smaller commitment? [Founding Limited](https://momence.com/m/633377) gives you 8 credits a month."
          },
          {
            "type": "button",
            "label": "Book a session",
            "url": "https://pyresauna.com/events"
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    },
    {
      "key": "after-expiry",
      "name": "Membership + credit packs",
      "archived": false,
      "timing": {
        "anchor": "intro-expiry",
        "offsetHours": 24
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "Keep the heat going",
        "preview": "Memberships and credit packs, whichever fits your rhythm.",
        "background": "trees",
        "blocks": [
          {
            "type": "heading",
            "text": "Keep the heat going, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "Your intro offer has wrapped up - thanks for trying us. There are two ways to keep coming back:"
          },
          {
            "type": "paragraph",
            "text": "**A membership**, if you want Pyre to be a regular part of your week:"
          },
          {
            "type": "list",
            "items": [
              "**Founding Unlimited - $199/month for life.** Come as often as you like, plus 4 guest passes a month and 10% off drinks and merch.",
              "**Founding Limited - $119/month.** 8 credits every month, 1 guest pass and 10% off drinks and merch."
            ]
          },
          {
            "type": "button",
            "label": "See memberships",
            "url": "https://pyresauna.com/#memberships"
          },
          {
            "type": "paragraph",
            "text": "**A credit pack**, if you'd rather come when it suits you. Credits can be shared with friends and family:"
          },
          {
            "type": "list",
            "items": [
              "**Circle - 4 credits for $85.** Come back often or bring your circle.",
              "**Ritual - 8 credits for $165.** Our best value for consistency."
            ]
          },
          {
            "type": "button",
            "label": "Buy a Ritual pack",
            "url": "https://momence.com/m/630916"
          },
          {
            "type": "paragraph",
            "text": "Or start smaller with a [Circle pack](https://momence.com/m/630915)."
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    }
  ]
}$json$::jsonb
);

insert into public.journeys (id, name, enabled, test_mode, definition)
values (
  'win-back-30-days',
  'Win-back after 30 days away',
  false,
  true,
  $json${
  "description": "For someone who hasn't been in for 30 days: a credits reminder if they have credits, otherwise a discount via the Win-back Discount tag (needs a matching Price Rule in Momence). At most once every 90 days.",
  "trigger": {
    "type": "sweep",
    "inactiveDays": 30,
    "minVisits": 1,
    "withTags": [],
    "withoutTags": []
  },
  "enrollIf": [
    {
      "type": "has-active-membership",
      "negate": true
    }
  ],
  "exitIf": [
    {
      "type": "visited-since-enrollment",
      "negate": false
    }
  ],
  "reentry": {
    "mode": "cooldown",
    "days": 90
  },
  "onEnd": [
    {
      "type": "remove-tag",
      "tag": "Win-back Discount"
    }
  ],
  "steps": [
    {
      "key": "credits-reminder",
      "name": "You still have credits",
      "archived": false,
      "timing": {
        "anchor": "trigger",
        "offsetHours": 1
      },
      "skipIf": [
        {
          "type": "has-credits",
          "negate": true
        }
      ],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "You still have {{creditsLabel}} at Pyre",
        "preview": "It's been a while - your credits are waiting.",
        "background": "clouds",
        "blocks": [
          {
            "type": "heading",
            "text": "We miss you, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "It's been about a month since your last session, and you still have **{{creditsLabel}}** on your account. Use them before {{creditsExpireOn|they expire}}."
          },
          {
            "type": "button",
            "label": "Book a session",
            "url": "https://pyresauna.com/events"
          },
          {
            "type": "paragraph",
            "text": "Credits can be shared, so bring someone who needs a reset as much as you do."
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    },
    {
      "key": "discount-offer",
      "name": "Come-back discount",
      "archived": false,
      "timing": {
        "anchor": "trigger",
        "offsetHours": 1
      },
      "skipIf": [
        {
          "type": "has-credits",
          "negate": false
        }
      ],
      "actions": [
        {
          "type": "add-tag",
          "tag": "Win-back Discount"
        }
      ],
      "content": {
        "type": "blocks",
        "subject": "A little something to bring you back, {{firstName|friend}}",
        "preview": "10% off your next purchase at Pyre.",
        "background": "lamps",
        "blocks": [
          {
            "type": "heading",
            "text": "Come back to the heat"
          },
          {
            "type": "paragraph",
            "text": "It's been about a month since we've seen you, {{firstName|friend}}. To make coming back easy, **your next purchase is 10% off** - a single session, a credit pack or a membership. The discount is already on your account; it applies at checkout."
          },
          {
            "type": "button",
            "label": "Book a session",
            "url": "https://pyresauna.com/events"
          },
          {
            "type": "paragraph",
            "text": "The offer runs for the next week."
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    },
    {
      "key": "discount-last-call",
      "name": "Discount ends tomorrow",
      "archived": false,
      "timing": {
        "anchor": "previous",
        "offsetHours": 144
      },
      "skipIf": [
        {
          "type": "has-credits",
          "negate": false
        }
      ],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "Your 10% off ends tomorrow",
        "preview": "Last call to come back for less.",
        "background": "trees",
        "blocks": [
          {
            "type": "heading",
            "text": "Last call, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "Your 10% off at Pyre ends tomorrow. Book a session or grab a credit pack before then and it applies automatically."
          },
          {
            "type": "button",
            "label": "Book a session",
            "url": "https://pyresauna.com/events"
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    },
    {
      "key": "discount-ends",
      "name": "Discount window closes (no email)",
      "archived": false,
      "timing": {
        "anchor": "previous",
        "offsetHours": 24
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "none"
      }
    }
  ]
}$json$::jsonb
);

insert into public.journeys (id, name, enabled, test_mode, definition)
values (
  'intro-offer-pitch',
  'Intro offer pitch',
  false,
  true,
  $json${
  "description": "For someone who came to a session without the intro offer: tells them about it while they're still eligible.",
  "trigger": {
    "type": "session-booked",
    "firstBookingOnly": false
  },
  "enrollIf": [
    {
      "type": "ever-bought-intro",
      "negate": true
    },
    {
      "type": "has-active-membership",
      "negate": true
    }
  ],
  "exitIf": [
    {
      "type": "ever-bought-intro",
      "negate": false
    },
    {
      "type": "has-active-membership",
      "negate": false
    }
  ],
  "reentry": {
    "mode": "once"
  },
  "onEnd": [],
  "steps": [
    {
      "key": "intro-pitch",
      "name": "Try the intro offer",
      "archived": false,
      "timing": {
        "anchor": "trigger",
        "offsetHours": 4
      },
      "skipIf": [
        {
          "type": "attended-trigger-session",
          "negate": true
        }
      ],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "Your next session is on us",
        "preview": "Buy one, get one free - our intro offer is still yours.",
        "background": "trees",
        "blocks": [
          {
            "type": "heading",
            "text": "Thanks for coming in, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "We noticed you haven't used our intro offer yet, and it's still yours: **two credits for $25** - buy one, get one free. Come back on your own or bring a friend."
          },
          {
            "type": "button",
            "label": "Get the intro offer",
            "url": "https://momence.com/m/630918"
          },
          {
            "type": "paragraph",
            "text": "It is available once per customer, and you can switch to a membership afterwards with the $25 taken off your first month."
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    }
  ]
}$json$::jsonb
);


insert into public.journey_revisions (journey_id, revision, name, definition, edited_by, note)
select id, revision, name, definition, 'migration', 'Initial version'
from public.journeys;
