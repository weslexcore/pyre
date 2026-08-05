---
cron: "0 14 * * 1"
---

Draft the staffing schedule for next week — the week starting the Monday
seven days from today, which is what get_week_context returns by default.
Call get_week_context with no weekStart, then save exactly one proposal via
save_proposal. If a previous draft exists for that week it will be superseded
automatically — just draft fresh from the current context.
