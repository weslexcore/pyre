# Event flows

Worked examples of how events move through `@pyre/integrations`, from the moment
something happens in the outside world to every side effect it produces. For the
high-level architecture, see the [README](../README.md).

- [1. A guest books a session](#1-a-guest-books-a-session)
- [2. A new member is created in Momence](#2-a-new-member-is-created-in-momence)
- [3. The hourly cron tick](#3-the-hourly-cron-tick)
- [4. A purchase enrolls someone in a journey](#4-a-purchase-enrolls-someone-in-a-journey)
- [5. A journey step comes due](#5-a-journey-step-comes-due)
- [6. Someone unsubscribes (any channel)](#6-someone-unsubscribes-any-channel)
- [7. Email engagement flows back as analytics](#7-email-engagement-flows-back-as-analytics)

---

## 1. A guest books a session

Momence fires `session-booked` at `/api/webhooks/momence`. One webhook produces a
confirmation email, possibly a first-timer welcome, an analytics event, and a
journey trigger — each behind its own idempotency guard so Momence retries are
harmless.

```mermaid
sequenceDiagram
    autonumber
    participant Momence
    participant WH as /api/webhooks/momence
    participant API as Momence API
    participant PH as PostHog
    participant Send as sendTemplate()
    participant Resend
    participant Engine as Journey engine

    Momence->>WH: POST session-booked {sessionId, memberId, ...}
    WH->>WH: verify shared secret + HMAC signature
    WH->>API: fetch member (email, name)
    WH->>API: resolve session (title, time, type, image)
    WH->>PH: capture booking_completed
    WH->>Send: confirmation email (transactional)
    Note over Send: Redis idempotency key<br/>confirmation:{sessionBookingId}<br/>skips webhook retries
    Send->>Resend: send "You're booked: {session}"
    opt First-ever booking for this member
        WH->>API: isMemberFirstBooking?
        WH->>Send: first-timer-welcome (best-effort)
        Send->>Resend: send welcome + FAQs
    end
    WH->>Engine: dispatchTrigger(session-booked)
    Note over Engine: May enroll into post-intro-offer<br/>(first booking ≈ intro offer).<br/>Never throws back to the webhook.
    WH-->>Momence: 200 OK
```

A `session-booking-cancelled` event takes a much shorter path: it only captures a
`booking_cancelled` PostHog event (best-effort — cancellation emails are
intentionally out of scope).

## 2. A new member is created in Momence

`member-assigned` / `member-updated` events keep the marketing audiences in sync.
Mailchimp is the primary sync target; Resend contacts are best-effort.

```mermaid
sequenceDiagram
    autonumber
    participant Momence
    participant WH as /api/webhooks/momence
    participant API as Momence API
    participant MC as Mailchimp
    participant Resend

    Momence->>WH: POST member-assigned {email, name, memberId}
    WH->>API: fetch member (phone, birthday, tags)
    WH->>MC: upsert subscriber
    WH->>MC: set tags (member tags + "Active Guest")
    WH->>Resend: upsert contact (best-effort — failure only logs)
    WH-->>Momence: 200 OK
```

Address events (`member-address-created/updated/deleted`) follow the same shape but
only update or clear the Mailchimp address field. The manual backfill endpoint
(`/api/webhooks/momence-backfill`) walks the full member list and runs this same
sync per member, for bootstrapping or repair.

## 3. The hourly cron tick

Everything Momence can't push to us is pulled on an hourly tick. Four jobs run
sequentially inside one ~50-second budget; any job that runs out of time saves a
Redis cursor and resumes on the next tick.

```mermaid
flowchart TD
    CRON["Upstash QStash schedule: 0 * * * *<br/>POST with forwarded Authorization header"] --> AUTH{"Bearer CRON_SECRET valid?"}
    AUTH -- no --> DENY["401"]
    AUTH -- yes --> SP

    subgraph tick["/api/cron/tick — shared time budget"]
        SP["sales-poll<br/>new sales since sales:cursor →<br/>purchase_completed events + purchase triggers"]
        JS["journey-sweeps<br/>page through sweep-journey audiences<br/>(e.g. 4+ visits for review-request), enroll matches"]
        JA["journey-advance<br/>load enrollments where next_at <= now,<br/>re-check exits live, send due steps"]
        CR["credit-reminders<br/>members with active packs →<br/>expiry (14d/3d) and unused-credit nudges"]
        SP --> JS --> JA --> CR
    end

    SP -. "cursor: sales:cursor" .-> REDIS[("Redis")]
    JS -. "cursor: sweep:journey:*:cursor" .-> REDIS
    CR -. "cursor: sweep:credit-reminders:cursor" .-> REDIS
    JA -. "state: journey_enrollments" .-> SB[("Supabase")]
```

The order matters: `sales-poll` runs first because a purchase it discovers can
enroll a member whose first step then advances later in the very same tick.

## 4. A purchase enrolls someone in a journey

Momence has no purchase webhook, so purchases are discovered by polling. Example:
someone buys the intro offer, which enrolls them in the `post-intro-offer` journey.

```mermaid
sequenceDiagram
    autonumber
    participant Tick as cron tick
    participant Poll as sales-poll
    participant API as Momence /host/sales
    participant Redis
    participant PH as PostHog
    participant Engine as Journey engine
    participant SB as Supabase

    Tick->>Poll: run
    Poll->>Redis: read sales:cursor (highest processed sale id)
    Poll->>API: fetch sales pages until cursor reached
    loop each new sale item of interest (membership, credits, gift card)
        Poll->>PH: capture purchase_completed
        Poll->>Engine: dispatchTrigger(purchase)
        Engine->>Engine: post-intro-offer.enroll.when()?<br/>itemType is membership AND saleItemId is an intro-offer id
        alt matches
            Engine->>SB: upsert journey_enrollments<br/>(journey_id, member_id) unique — step 0, next_at = now + 72h
            Note over SB: If a row already exists (even completed/exited)<br/>the upsert is a no-op — once per lifetime.
            Engine->>PH: capture journey_enrolled
        end
    end
    Poll->>Redis: advance sales:cursor
```

On its very first run the poller **baselines** the cursor at the newest sale rather
than replaying history — journeys react to purchases from now on, not to every old
customer at once.

## 5. A journey step comes due

Enrollment rows store only `(step, next_at)`. Everything else — did they buy a
membership? have they visited? did they unsubscribe? — is re-checked live at send
time. Example: the `post-intro-offer` membership pitch on day ~21.

```mermaid
sequenceDiagram
    autonumber
    participant JA as journey-advance (cron)
    participant SB as Supabase
    participant API as Momence Host API
    participant Send as sendTemplate()
    participant Resend

    JA->>SB: select enrollments where status=active and next_at <= now
    loop each due enrollment
        JA->>API: fetch live member (visits, packs)
        JA->>JA: exitWhen()? — bought anything beyond the intro?
        alt exit condition met
            JA->>SB: status=exited, reason=already-purchased
        else step.skipIf()? — fewer than 2 visits
            JA->>SB: advance to next step without sending
        else send the step
            JA->>Send: membership-pitch (marketing,<br/>sendKey journey:post-intro-offer:{member}:membership)
            Send->>SB: claim send_key in email_sends (unique)
            Send->>Resend: send with List-Unsubscribe headers
            JA->>SB: advance step / mark completed
        end
    end
```

The full lifecycle of an enrollment:

```mermaid
stateDiagram-v2
    [*] --> active : enrolled (event or sweep)
    active --> active : step sent or skipped → next_at rescheduled
    active --> exited : exitWhen() true · unsubscribed · journey removed
    active --> completed : past the last step
    completed --> [*]
    exited --> [*]
```

If a send throws, the enrollment row is left untouched and the send-key claim is
released — the next hourly tick simply retries, and the dedupe makes that safe.

## 6. Someone unsubscribes (any channel)

All opt-out signals converge on the `email_suppressions` table, then fan back out
so every sending channel stops. Example: a recipient clicks the footer link in a
journey email.

```mermaid
sequenceDiagram
    autonumber
    participant User as Recipient
    participant UNSUB as /api/unsubscribe
    participant SUP as suppressEmail()
    participant SB as Supabase
    participant Resend
    participant MC as Mailchimp
    participant Send as future marketing sends

    User->>UNSUB: GET ?token=... (or POST via one-click header)
    UNSUB->>UNSUB: verify HMAC token → email address
    Note over UNSUB: Token is signed at send time —<br/>no per-recipient state, can't be forged.
    UNSUB->>SUP: suppress(email, unsubscribe)
    SUP->>SB: upsert email_suppressions (idempotent, first reason wins)
    par mirror to Resend (best-effort)
        SUP->>Resend: mark contact unsubscribed
    and mirror to Mailchimp (best-effort)
        SUP->>MC: set subscriber status unsubscribed
    end
    UNSUB-->>User: confirmation page
    Note over Send: Every later marketing send calls isSuppressed()<br/>and skips this address. Transactional email<br/>(booking confirmations) is unaffected.
```

The same `suppressEmail()` path is fed by two other inputs:

| Source | Trigger | Reason recorded |
| --- | --- | --- |
| Resend webhook | hard bounce / spam complaint / contact unsubscribed | `bounce` / `complaint` / `unsubscribe` |
| Mailchimp webhook | audience unsubscribe / cleaned (hard bounces) | `unsubscribe` / `bounce` |

A journey enrollment whose recipient turns out to be suppressed exits with reason
`unsubscribed` the next time a step comes due.

## 7. Email engagement flows back as analytics

Every send attaches Resend tags (`template`, `kind`, `journey`, `step`,
`campaign`). Resend's webhooks echo those tags back, so engagement lands in PostHog
already attributed to the exact journey step that sent it — using the recipient's
email as the distinct id, the same key as `booking_completed`.

```mermaid
sequenceDiagram
    autonumber
    participant Resend
    participant WH as /api/webhooks/resend
    participant SUP as Suppression
    participant PH as PostHog

    Resend->>WH: POST email.opened {to, tags: {journey, step, ...}}
    WH->>WH: verify svix HMAC signature (5 min tolerance)
    alt email.bounced (permanent) or email.complained
        WH->>SUP: suppressEmail(recipient)
    end
    WH->>PH: capture email_opened<br/>{template, journey, step, campaign, resend_email_id}
    WH-->>Resend: 200 OK
```

This closes the loop: `journey_enrolled` → `journey_email_sent` →
`email_delivered/opened/clicked` → (ideally) `purchase_completed`, all stitched by
email in PostHog.
