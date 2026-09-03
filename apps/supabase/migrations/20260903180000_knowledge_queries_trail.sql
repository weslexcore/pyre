-- The knowledge assistant's trail per question: what it said to itself
-- between lookups and every tool call with its input and result, in order.
-- The Ask page builds the same trail live from the session stream and
-- keeps it beside the answer; storing it here is what lets a reopened
-- conversation (and the admin review log) show it again.
--
-- tool_calls stays as the compact audit of what was called; trail carries
-- the narration and the results as well, each output cut to a few thousand
-- characters. Written by pyre-agents (apps/agents/agent/lib/knowledge/audit.ts).
--
-- Shape: [
--   { "kind": "thought", "text": "Let me check the water log." },
--   { "kind": "tool", "callId": "…", "tool": "get_water_log", "input": {…},
--     "status": "running" | "completed" | "failed", "output": "…", "error": "…" }
-- ]

alter table public.knowledge_queries
  add column trail jsonb not null default '[]'::jsonb
    check (jsonb_typeof(trail) = 'array');

comment on column public.knowledge_queries.trail is
  'Ordered narration and tool calls (with inputs and capped outputs) for the turn, as shown on /admin/ask.';
