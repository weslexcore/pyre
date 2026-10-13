-- Journeys stop depending on coded email templates.
--
-- The integrations app is dropping the hand-coded marketing templates
-- (intro-follow-up, credit-pack-pitch, membership-pitch, review-request,
-- credit-expiry-reminder, unused-credit-reminder): every journey email is now
-- written as blocks in /admin/journeys, and journey steps can no longer point
-- at a coded template at all. So:
--
--   * review-request — its one step ("ask", key unchanged so nobody is asked
--     twice) becomes a dashboard-written email with the same copy and Google
--     review link.
--   * post-intro-offer — retired: switched off and archived (intro-to-membership
--     replaces it). Anyone still in it is taken out, and its steps become
--     archived no-email steps so the stored definition stays valid; the old
--     version is still in journey_revisions.
--   * credit-expiry-reminders, unused-credits-reminder — new journeys replacing
--     the hourly credit-reminders job (deleted from the app): a reminder when
--     credits expire within 14 days plus a last call 3 days out, and a nudge
--     for credits sitting unused 45+ days. Added switched off and in test mode;
--     until someone turns them on, nobody gets credit reminders. Their links
--     keep the old job's utm_campaign values (credit-expiry, unused-credit).
--
-- Each change is guarded so it only applies to the journey as seeded; a
-- journey an admin has already edited is left alone.

-- --- review-request: the coded template becomes blocks ---

update public.journeys
set
  definition = jsonb_set(
    definition,
    '{steps,0}',
    $step${
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
    "type": "blocks",
    "subject": "Mind sharing the heat?",
    "preview": "You know Pyre by now - mind sharing the heat?",
    "background": "trees",
    "blocks": [
      {
        "type": "heading",
        "text": "You're one of the regulars now, {{firstName|friend}}"
      },
      {
        "type": "paragraph",
        "text": "You've been in the heat with us a few times now, and that means the world to a small, founder-run sauna like ours.\n\nIf Pyre has earned a place in your week, would you take a minute to say so in a Google review? It's the single biggest thing that helps new people find us - and it genuinely keeps the fire going."
      },
      {
        "type": "button",
        "label": "Leave a review",
        "url": "https://g.page/r/CbPLgfm6vte6EAI/review",
        "color": "red",
        "style": "filled",
        "fullWidth": false
      },
      {
        "type": "divider"
      },
      {
        "type": "paragraph",
        "text": "And if anything about your visits hasn't been right, skip the review and reply here instead - we want to fix it."
      },
      {
        "type": "signoff",
        "text": "Thank you. Wes + Julien"
      }
    ]
  }
}$step$::jsonb
  ),
  revision = revision + 1,
  updated_by = 'migration'
where id = 'review-request'
  and definition #>> '{steps,0,key}' = 'ask'
  and definition #>> '{steps,0,content,type}' = 'template';

insert into public.journey_revisions (journey_id, revision, name, definition, edited_by, note)
select id, revision, name, definition, 'migration', 'Email rewritten as blocks (coded template retired)'
from public.journeys
where id = 'review-request'
  and updated_by = 'migration'
  and definition #>> '{steps,0,content,type}' = 'blocks'
on conflict (journey_id, revision) do nothing;

-- --- post-intro-offer: retired ---

update public.journey_enrollments
set
  status = 'exited',
  exit_reason = 'journey-retired',
  next_at = null,
  ended_at = now()
where journey_id = 'post-intro-offer'
  and status = 'active';

update public.journeys
set
  enabled = false,
  archived = true,
  definition = jsonb_set(
    jsonb_set(
      definition,
      '{description}',
      to_jsonb('Retired - replaced by "Intro to membership". The original emails were coded templates, removed from the app; see the revision history for the old version.'::text)
    ),
    '{steps}',
    (
      select coalesce(jsonb_agg(
        (step - 'content') || jsonb_build_object('archived', true, 'content', jsonb_build_object('type', 'none'))
        order by ord
      ), '[]'::jsonb)
      from jsonb_array_elements(definition -> 'steps') with ordinality as s(step, ord)
    )
  ),
  revision = revision + 1,
  updated_by = 'migration'
where id = 'post-intro-offer'
  and exists (
    select 1
    from jsonb_array_elements(definition -> 'steps') step
    where step #>> '{content,type}' = 'template'
  );

insert into public.journey_revisions (journey_id, revision, name, definition, edited_by, note)
select id, revision, name, definition, 'migration', 'Retired; replaced by Intro to membership'
from public.journeys
where id = 'post-intro-offer'
  and archived
  and updated_by = 'migration'
on conflict (journey_id, revision) do nothing;

-- --- credit reminders as journeys ---

insert into public.journeys (id, name, enabled, test_mode, definition)
values (
  'credit-expiry-reminders',
  'Credits about to expire',
  false,
  true,
  $json${
  "description": "Replaces the old hourly credit-expiry job: when someone has a pack with credits left that expires within 14 days, a reminder, then a last call 3 days before. Leaves once their credits are used.",
  "trigger": {
    "type": "sweep",
    "withTags": [],
    "withoutTags": [],
    "withActivePurchase": true
  },
  "enrollIf": [
    {
      "type": "credits-expire-within",
      "negate": false,
      "count": 14
    }
  ],
  "exitIf": [
    {
      "type": "has-credits",
      "negate": true
    }
  ],
  "reentry": {
    "mode": "cooldown",
    "days": 7
  },
  "onEnd": [],
  "campaign": "credit-expiry",
  "steps": [
    {
      "key": "two-weeks",
      "name": "Credits expire soon",
      "archived": false,
      "timing": {
        "anchor": "trigger",
        "offsetHours": 1
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "Your {{creditsLabel}} expire {{creditsExpireOn}}",
        "preview": "Your credits expire on {{creditsExpireOn}} - come use them",
        "background": "lamps",
        "blocks": [
          {
            "type": "heading",
            "text": "Don't let the heat go to waste, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "You still have {{creditsLabel}}, and they expire on **{{creditsExpireOn}}**.\n\nGrab a spot at any upcoming session - social, silent, or guided - and put them to good use."
          },
          {
            "type": "button",
            "label": "Book before they expire",
            "url": "https://pyresauna.com/events",
            "color": "red",
            "style": "filled",
            "fullWidth": false
          },
          {
            "type": "divider"
          },
          {
            "type": "paragraph",
            "text": "Can't make it in time? Reply and we'll see what we can do - we'd rather you sweat than lose them."
          },
          {
            "type": "signoff",
            "text": "Wes + Julien"
          }
        ]
      }
    },
    {
      "key": "three-days",
      "name": "Last call (3 days left)",
      "archived": false,
      "timing": {
        "anchor": "credits-expiry",
        "offsetHours": -72
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "Last call: your {{creditsLabel}} expire {{creditsExpireOn}}",
        "preview": "Only a few days left to use your credits",
        "background": "lamps",
        "blocks": [
          {
            "type": "heading",
            "text": "Only a few days left, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "Your {{creditsLabel}} expire on **{{creditsExpireOn}}** - that is only {{daysUntilCreditsExpire|a few}} days away.\n\nThere is still time to book a session and use them."
          },
          {
            "type": "button",
            "label": "Book before they expire",
            "url": "https://pyresauna.com/events",
            "color": "red",
            "style": "filled",
            "fullWidth": false
          },
          {
            "type": "divider"
          },
          {
            "type": "paragraph",
            "text": "Can't make it in time? Reply and we'll see what we can do - we'd rather you sweat than lose them."
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
  'unused-credits-reminder',
  'Unused credits',
  false,
  true,
  $json${
  "description": "Replaces the old hourly unused-credit job: someone with credits left who hasn't been in for 45 days (and whose credits aren't about to expire - the expiry journey covers that) gets a nudge, at most once every 90 days.",
  "trigger": {
    "type": "sweep",
    "inactiveDays": 45,
    "withTags": [],
    "withoutTags": [],
    "withActivePurchase": true
  },
  "enrollIf": [
    {
      "type": "has-credits",
      "negate": false
    },
    {
      "type": "credits-expire-within",
      "negate": true,
      "count": 30
    }
  ],
  "exitIf": [
    {
      "type": "visited-since-enrollment",
      "negate": false
    },
    {
      "type": "has-credits",
      "negate": true
    }
  ],
  "reentry": {
    "mode": "cooldown",
    "days": 90
  },
  "onEnd": [],
  "campaign": "unused-credit",
  "steps": [
    {
      "key": "nudge",
      "name": "Your credits are waiting",
      "archived": false,
      "timing": {
        "anchor": "trigger",
        "offsetHours": 1
      },
      "skipIf": [],
      "actions": [],
      "content": {
        "type": "blocks",
        "subject": "You still have {{creditsLabel}} at Pyre",
        "preview": "You still have {{creditsLabel}} waiting at Pyre",
        "background": "trees",
        "blocks": [
          {
            "type": "heading",
            "text": "The sauna misses you, {{firstName|friend}}"
          },
          {
            "type": "paragraph",
            "text": "It's been a little while - and you still have {{creditsLabel}} on your account, ready whenever you are.\n\nAn hour of heat, a cold plunge, and you'll remember why you came the first time. Pick any session that fits your week."
          },
          {
            "type": "button",
            "label": "Use a credit",
            "url": "https://pyresauna.com/events",
            "color": "red",
            "style": "filled",
            "fullWidth": false
          },
          {
            "type": "divider"
          },
          {
            "type": "paragraph",
            "text": "Life gets busy - no guilt here. If something kept you away that we can fix, reply and tell us."
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
select id, revision, name, definition, 'migration', 'Replaces the credit-reminders job'
from public.journeys
where id in ('credit-expiry-reminders', 'unused-credits-reminder')
on conflict (journey_id, revision) do nothing;
