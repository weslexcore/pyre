// Row shapes for the staff-scheduling tables (see the staff_scheduling and
// schedule_proposals migrations in apps/supabase). Dates are YYYY-MM-DD and
// times are local wall-clock 'HH:MM' / 'HH:MM:SS' strings — America/New_York,
// never UTC. Shared by apps/integrations (which re-exports them from lib/db)
// and apps/agents.

/**
 * A person: one row covers both the scheduling roster and dashboard access
 * (the two used to be separate tables — see the merge migration). Managed from
 * /admin/users.
 */
export interface StaffRow {
	id: string;
	display_name: string;
	/**
	 * Momence account email — the join key against the OAuth profile, for both
	 * "whose schedule is this" and "may they use the dashboard". Null until the
	 * person's account email is confirmed.
	 */
	email: string | null;
	is_founder: boolean;
	/**
	 * May anchor a shift. Anyone without this (and without is_founder) must be
	 * scheduled alongside a founder or a shift lead — the boards flag shifts
	 * whose whole crew is lead-less.
	 */
	is_shift_lead: boolean;
	/** Available to be scheduled; false = off the roster, history preserved. */
	active: boolean;
	/** Dashboard: sees every admin page and manages people. */
	is_admin: boolean;
	/** Admin page hrefs / capability keys granted to a non-admin. */
	pages: string[];
	momence_member_id: number | null;
	/** Email of the admin who added them. */
	added_by: string | null;
	/**
	 * Secret for their personal shift calendar feed — the whole auth gate on
	 * /api/schedule/feed.ics, since calendar clients poll without cookies. Null
	 * until they first open the Subscribe panel. Only ever returned to its
	 * owner; redacted from every roster payload.
	 */
	calendar_token: string | null;
	created_at: string;
	updated_at: string;
}

export interface ShiftRow {
	id: string;
	shift_date: string;
	label: string;
	starts_at: string;
	ends_at: string;
	staff_needed: number;
	source: "momence" | "manual";
	momence_session_ids: Array<{ type: string; id: number }>;
	sync_locked: boolean;
	notes: string | null;
	status: "active" | "cancelled";
	/** Set when this row belongs (or belonged) to an agent draft batch. */
	proposal_id: string | null;
	/** Draft rows are only visible to the review UI until approved. */
	is_draft: boolean;
	/** Momence divergence the sync couldn't silently fix — needs admin eyes. */
	sync_flag: "sessions_cancelled" | "times_changed" | null;
	created_at: string;
	updated_at: string;
}

export interface ShiftAssignmentRow {
	id: string;
	shift_id: string;
	staff_id: string;
	starts_at: string;
	ends_at: string;
	role: "full" | "setup" | "partial";
	notes: string | null;
	proposal_id: string | null;
	is_draft: boolean;
	created_at: string;
	updated_at: string;
}

/**
 * An employee's ask to work a shift, decided by a schedule manager. Approval
 * creates the shift_assignments row; the request row stays as the paper
 * trail. Only one pending request per (shift, person).
 */
export interface ShiftRequestRow {
	id: string;
	shift_id: string;
	staff_id: string;
	status: "pending" | "approved" | "denied";
	/** What they offered to work: the whole shift, or just its setup span. */
	role: "full" | "setup";
	/** Optional message from the requester. */
	note: string | null;
	/** Dashboard email of the manager who decided; null while pending. */
	decided_by: string | null;
	decided_at: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * An employee's ask for a sub on a shift they're assigned to. Creating one
 * logs their hours as time off (time_off_id) and emails admins plus everyone
 * available that day; the requester keeps the assignment until a claim swaps
 * it to the claimer. The window/role are copied from the assignment at
 * request time so the swap can recreate them.
 */
export interface SubRequestRow {
	id: string;
	shift_id: string;
	requester_staff_id: string;
	starts_at: string;
	ends_at: string;
	role: "full" | "setup" | "partial";
	/** The blackout entry created with the request; null if it was deleted. */
	time_off_id: string | null;
	status: "open" | "claimed" | "cancelled";
	claimed_by_staff_id: string | null;
	claimed_at: string | null;
	/** How many available people were emailed a claim link. */
	notified_count: number;
	created_at: string;
	updated_at: string;
}

export interface TimeOffRow {
	id: string;
	staff_id: string;
	kind: "range" | "recurring";
	start_date: string | null;
	end_date: string | null;
	/** 0 = Sunday .. 6 = Saturday (matches JS Date.getDay()). */
	days_of_week: number[];
	starts_at: string | null;
	ends_at: string | null;
	note: string | null;
	created_by: "staff" | "admin";
	created_at: string;
	updated_at: string;
}

export interface ScheduleProposalRow {
	id: string;
	/** Monday of the drafted week. */
	week_start: string;
	status: "draft" | "approved" | "superseded" | "discarded";
	/** Agent's markdown summary shown on the board. */
	rationale: string | null;
	summary: Record<string, unknown>;
	source: "cron" | "manual";
	agent_session_id: string | null;
	decided_at: string | null;
	created_at: string;
	updated_at: string;
}
