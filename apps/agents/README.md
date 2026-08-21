# pyre-agents

Vercel [Eve](https://eve.dev) app hosting Pyre's AI agents — first up: the
**staff-scheduling drafter**, which reviews upcoming coverage shifts (synced
from Momence by the integrations app), everyone's time off, hours, and history
patterns, then drafts a week of assignments the admin reviews on
`/admin/schedule` (approve week, ✓/✗ per item, or discard).

## How it fits together

```
Momence ──(sync-shifts cron + admin buttons, apps/integrations)──▶ shifts table
                                                                      │
agent/tools/get_week_context ── reads Supabase directly ──────────────┤
agent/tools/save_proposal ──▶ POST /api/agent/proposals (integrations)│
                                  validates + writes draft batch      │
admin board ── proposal banner, dashed "AI draft" cards, approve ─────┘
```

- The agent holds **no Momence credentials** and does **no schedule writes**
  of its own: reads go straight to Supabase with a dedicated key; the one
  write path is the integrations endpoint, which validates drafts with the
  same parsers as manual edits and hard-rejects assignments over busy time
  off. Shared pure logic (availability, hours, window math) lives in
  `@pyre/schedule-core`.
- Triggers: the board's "✦ Draft schedule" button (`POST
  /api/admin/schedule-draft` → `POST {this app}/eve/v1/session`) and the
  weekly schedule in `agent/schedules/weekly_draft.md` (Mon 14:00 UTC →
  a Vercel Cron Job on deploy).
- The button opens a composer first: the admin can add an optional note for
  the run ("give Sarah a shift to lead"), which rides in as an `<admin-note>`
  block on the session's opening message. It steers judgment only — the hard
  rules in `agent/instructions.md` and the server-side validation still bind.
- Re-drafting a week supersedes its open draft; accepted rows are never
  touched.

## Environment

See `.env.example`. Key segmentation is per deployment boundary: one
dedicated Supabase secret key for this whole app (`SUPABASE_AGENTS_SECRET_KEY`
— mint it in the Supabase dashboard, revocable independently of
integrations'), `AGENT_API_SECRET` for outbound writes to integrations,
`EVE_CHANNEL_SECRET` for inbound session triggers. A future agent needing
riskier access should graduate to its own Eve app + Vercel project.

## Local dev (Node 24)

```bash
nvm use 24
yarn workspace pyre-agents dev          # eve dev (schedules never auto-fire locally)
```

Point `INTEGRATIONS_BASE_URL` at a local integrations dev server. For evals
without writing anything, set `AGENT_FORCE_DRY_RUN=1` and run
`yarn workspace pyre-agents eval`.

## Deploy checklist

1. Migrations applied (`staff_scheduling`, `staff_scheduling_import`,
   `schedule_proposals`): `yarn workspace @pyre/supabase migrate` locally,
   `db:push` for prod.
2. Mint the agents Supabase key; generate `AGENT_API_SECRET` and
   `EVE_CHANNEL_SECRET` (e.g. `openssl rand -hex 32`).
3. New Vercel project **pyre-agents**: Root Directory `apps/agents`, Node 24,
   AI Gateway enabled, env vars from `.env.example`.
4. pyre-integrations env additions: `AGENT_API_SECRET`, `AGENTS_BASE_URL`
   (this app's deployment URL), `EVE_CHANNEL_SECRET`.
5. **Protected (preview/staging) deployments only.** Vercel Deployment
   Protection 401s server-to-server calls at the edge, before either app's
   own bearer check runs. For each protected side, Settings → Deployment
   Protection → Protection Bypass for Automation → generate, then hand the
   secret to the *caller*: pyre-agents' secret becomes
   `AGENTS_PROTECTION_BYPASS` on pyre-integrations, and pyre-integrations'
   becomes `INTEGRATIONS_PROTECTION_BYPASS` on pyre-agents. Both hops need it
   — the button-draft call out and the `save_proposal` write back. Leave both
   unset in production, where neither deployment is protected.
6. Verify `GET /eve/v1/health`, then button-draft a future week from
   `/admin/schedule`.
7. The weekly cron registers automatically on deploy (check Vercel
   Observability → Cron Jobs). If plan limits block Vercel Cron, delete
   `agent/schedules/weekly_draft.md` and add a QStash schedule (or a
   `CRON_JOBS` entry in integrations) POSTing the same `/eve/v1/session`
   message the button sends.
