# pyre-agents

Vercel [Eve](https://eve.dev) app hosting Pyre's AI agents. One deployment,
two roles, chosen per session:

- the **staff-scheduling drafter** (the default), which reviews upcoming
  coverage shifts (synced from Momence by the integrations app), everyone's
  time off, hours, and history patterns, then drafts a week of assignments the
  admin reviews on `/admin/schedule` (approve week, ✓/✗ per item, or discard);
- the **knowledge assistant**, shown to staff as **Pyre Agent**, which
  answers staff questions ("What are the benefits of cold plunging?", "When
  was the left tub last shocked?", "When is my next shift?") from the SOP
  library, shift notes, the cold tub water log, incident reports, and the
  staff schedule, citing the dashboard pages it drew on — and, for people
  with boards, gives goal status updates and proposes boards, tasks, and task
  changes they apply from the chat. Staff reach it from `/admin/ask`.

Jev (TypeSafe AI's evaluation model) is not hosted here: it is an AI
Gateway model any app calls directly through `@pyre/jev`
(`packages/jev`). Shift note classification runs in the integrations app
(`@pyre/signals-core`). An agent tool that needs Jev imports `askJev` the
same way.

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

Both roles run with eve's optional built-in tools off (`defaultTools: false`
in `agent/agent.ts`: no sandbox, web, delegation, or question tools): the
scheduler works from
`get_week_context`, the assistant from the knowledge base, and document text
never gets a shell.

### Knowledge assistant

```
/admin/sops/ask ──▶ POST /api/admin/knowledge-ask (integrations)
                        resolves the asker's scope: SOP role + email,
                        shift-notes / incidents (all | mine | none), water,
                        schedule
                        │  x-pyre-agent: knowledge, x-pyre-knowledge-scope
                        ▼
                    POST {this app}/eve/v1/session
                        search_knowledge_base ─▶ knowledge_search() in Postgres
                        list_sops / read_sop ─▶ sops (grant-filtered)
                        get_water_log / get_shift_notes / read_incident
                        get_shifts ─▶ shifts, shift_assignments, staff (names only)
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
- **Access parity.** The assistant can only surface what the dashboard would
  show the same person: SOPs by the document's grants (admins everything,
  others by role or named email, archived hidden), shift notes all-or-own,
  incident reports all-or-own-filed with people fields withheld, the water
  log and the schedule by page grant. The scope comes from the integrations
  app's own access code, tools re-derive it from the session on every call,
  and the SQL function applies it row by row. `tests/access.test.ts` covers
  the agent-side rules.
- **Schedule.** `get_shifts` (`agent/lib/knowledge/schedule.ts`) reads
  shifts, assignments, and the roster directly for a date window and shapes
  them the way the board shows an employee: every shift with its crew by
  display name, the asker's own hours by week, their own pending shift
  requests, and open sub requests (which every teammate sees). The asker is
  the staff row matching the scope's email. Emails, pay rates, calendar
  tokens, Momence ids, other people's requests, and draft (proposal) rows
  never leave the database through it. The knowledge prompt gets today's
  Eastern date appended per turn so "last week" resolves to real dates.
  `tests/schedule.test.ts` pins the window and shaping logic.
- **Who may ask** is the "Ask" checkbox on `/admin/users` (the
  `/admin/ask` page grant); the dashboard's ask route checks it on every
  request.
- **Audit log.** Every question lands in `public.knowledge_queries`
  (migration `20260903130000_knowledge_queries`) with the asker, their
  scope, each tool call and its input, the answer, and the outcome. The
  channel handlers in `agent/channels/eve.ts` and the hook in
  `agent/hooks/knowledge_audit.ts` write it from the event stream, so a
  closed browser tab never loses a record. Admins review it at
  `/admin/ask/log`.
- **Goals and boards.** When the scope says `boards` (the person holds the
  Boards tool or a `board:<slug>` grant), the role also gets
  `get_goals_and_boards`, `read_board`, `find_cards`, and the `propose_*`
  tools (`agent/lib/knowledge/boards.ts`). All of them call the integrations
  app's `POST /api/agent/pyre` with the asker's email from the scope; that
  route resolves their grants fresh on every call and owns the progress
  math. Proposals never touch a board: each is stored in
  `public.pyre_agent_actions` (migration `20261016161625_pyre_agent_actions`)
  as the exact dashboard request to replay, drawn in the chat with Apply and
  Dismiss, and applied by `/api/admin/agent-actions` through the board routes
  as the person.
- **Routines.** People save requests on `/admin/ask/routines` to run on a
  cadence (daily, chosen weekdays, or a day of the month, at an Eastern
  hour). The integrations cron tick (`pyre-agent-routines`) opens each due
  run as a knowledge session for the routine's owner, with
  `x-pyre-routine-run: <run id>`; the channel stamps it on the session as
  `routine`, and when the turn ends it reports to the integrations app's
  `POST /api/agent/routines` (`agent/lib/knowledge/routines.ts`), which closes
  the run and notifies the owner. Tables: `pyre_agent_routines`,
  `pyre_agent_routine_runs` (migration `20261016170216_pyre_agent_routines`).
- **Conversations that outlive their session.** When someone writes into a
  conversation whose session has ended, the integrations ask route starts a
  new session whose opening message carries the conversation so far in an
  `<earlier-conversation>` block (newest turns first to fit, scrubbed of the
  message's own tags; `lib/knowledge/carry.ts` there) and links the new
  session to the conversation in `public.pyre_agent_session_links`
  (migration `20261016172954_pyre_agent_session_links`), so the history shows
  one conversation across sessions.
- **Leaving and coming back.** The Pyre Agent page keeps the open
  conversation in `?c=` and localStorage. On return it reloads the history
  and, when the last question is still being answered, reattaches through the
  ask route's resume mode, which replays the session's newest turn from its
  `turn.started` and then streams live.

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
- **Standing instructions.** The requirements that hold every week ("Wes
  never works Sundays") are kept once by an admin, in the ⚙ Settings panel on
  `/admin/schedule`, and stored as the singleton
  `schedule_agent_instructions` row (migration
  `20260917120000_schedule_agent_instructions`, written via `POST
  /api/admin/schedule-instructions`, admin-only). This app reads that row
  when a scheduler session starts (`agent/lib/prompts/standing.ts`, ~30s
  cache) and `schedulerInstructionsWith` appends it to the system prompt as a
  `<standing-instructions>` block — so it reaches board drafts, refinement
  turns, and the weekly cron run alike, with no redeploy. Precedence, spelled
  out in the prompt: hard rules > a run's `<admin-note>` > standing
  instructions > the judgment guidelines. Both sides sanitise the text
  (`sanitizeStandingInstructions` in `@pyre/schedule-core`), and an
  unreachable row reads as "none set" rather than failing the draft.
- Re-drafting a week supersedes its open draft; accepted rows are never
  touched.

## Environment

See `.env.example`. Key segmentation is per deployment boundary: one
dedicated Supabase secret key for this whole app (`SUPABASE_AGENTS_SECRET_KEY`
— mint it in the Supabase dashboard, revocable independently of
integrations'), `AGENT_API_SECRET` for outbound writes to integrations,
`EVE_CHANNEL_SECRET` for inbound session triggers. A future agent needing
riskier access should graduate to its own Eve app + Vercel project.

## Session protocol (eve ≥ 0.31)

Sessions are addressed by id alone: follow-ups `POST /eve/v1/session/:id`
with `{ message }` (no continuation token), an ended session answers `409
session_not_active`, and the channel sets `turnPolicy: "queue"` so a
follow-up waits for an active turn instead of steering it. Stream text
appends are deltas (`messageDelta`); the integrations Ask proxy accumulates
them. See `apps/integrations/src/lib/schedule/eve-session.ts`.

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
