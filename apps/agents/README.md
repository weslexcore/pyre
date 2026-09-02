# pyre-agents

Vercel [Eve](https://eve.dev) app hosting Pyre's AI agents. One deployment,
two roles, chosen per session:

- the **staff-scheduling drafter** (the default), which reviews upcoming
  coverage shifts (synced from Momence by the integrations app), everyone's
  time off, hours, and history patterns, then drafts a week of assignments the
  admin reviews on `/admin/schedule` (approve week, ✓/✗ per item, or discard);
- the **knowledge assistant**, which answers staff questions ("What are the
  benefits of cold plunging?", "When was the left tub last shocked?") from
  the SOP library, shift notes, the cold tub water log, and incident reports,
  citing the dashboard pages it drew on. Staff reach it from
  `/admin/sops/ask`.

## Two roles in one Eve app

Eve builds one root agent per app, so the second agent is a *role* the same
deployment switches into: `agent/instructions/role.ts` and
`agent/tools/role_tools.ts` are dynamic resolvers that pick the system prompt
(`agent/lib/prompts/*`) and the tool set from the session's auth attributes
(`agent/lib/role.ts`). A request to `POST /eve/v1/session` carrying
`x-pyre-agent: knowledge` runs as the assistant; the channel
(`agent/channels/eve.ts`) stamps that, plus the asking staff member's access
as JSON from `x-pyre-knowledge-scope`, onto the session. Everything else —
cron schedules, the board's draft button, evals by default — is the
scheduler. The initiator decides for the life of a session, so a follow-up
can never flip a conversation to the other role, and a knowledge session
never sees `save_proposal`.

Both roles run with the sandbox, web, delegation, and question tools
disabled (`agent/tools/{bash,read_file,...}.ts`): the scheduler works from
`get_week_context`, the assistant from the knowledge base, and document text
never gets a shell.

### Knowledge assistant

```
/admin/sops/ask ──▶ POST /api/admin/knowledge-ask (integrations)
                        resolves the asker's scope: SOP role + email,
                        shift-notes / incidents (all | mine | none), water
                        │  x-pyre-agent: knowledge, x-pyre-knowledge-scope
                        ▼
                    POST {this app}/eve/v1/session
                        search_knowledge_base ─▶ knowledge_search() in Postgres
                        list_sops / read_sop ─▶ sops (grant-filtered)
                        get_water_log / get_shift_notes / read_incident
                        ▼
                    GET /api/admin/knowledge-ask?sessionId… streams the answer
```

- Retrieval is Postgres full-text search: `public.knowledge_search(...)`
  (migration `20260903100000_knowledge_search`) ranks SOP titles/bodies,
  shift-note bodies, incident narratives, and water-log notes with
  `ts_rank_cd`, returns `ts_headline` snippets, and applies the dashboard's
  visibility rules from the scope it is passed. The tool then finds the
  matching section of each SOP hit so links carry a `#section` anchor (the
  anchor scheme mirrors the dashboard's `headingId`).
- The tools re-derive the scope from the session's auth on every call, and
  incident reads never return the people fields (names, contact details).
- Links use `KNOWLEDGE_SITE_URL` (default `https://integrations.pyresauna.com`)
  as the dashboard origin; the Ask island makes them relative again so
  in-library links open in the peek modal.
- The read-only "not covered" answer is by design: the prompt
  (`agent/lib/prompts/knowledge.ts`) forbids filling gaps from general
  knowledge.

### Staff-scheduling drafter

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
