---
cron: "0 14 * * 3"
---

Draft the staffing schedule for next week (the Monday after the coming
weekend). Use get_week_context, then save exactly one proposal via
save_proposal. If a previous draft exists for that week it will be superseded
automatically — just draft fresh from the current context.
