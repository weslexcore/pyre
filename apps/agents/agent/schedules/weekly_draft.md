---
cron: "0 14 * * 1"
---

Draft the staffing schedule for next week — the week starting the Monday
seven days from today, which is what get_week_context returns by default.
Call get_week_context with no weekStart, then save exactly one proposal via
save_proposal. Fill only shifts still below their staffNeeded count — leave
fully staffed shifts untouched, and never add more people than a shift's
remaining need. Apply every scheduling rule in your instructions — shift-lead
coverage, weekly hour targets, and pending shift requests included. If a
previous draft exists for that week it will be superseded automatically —
just draft fresh from the current context.
