// The floor's Realtime topic (see the live_notes_boards_checkins migration):
// one message per change to guest_floor_checkins — a check-in, a check-out,
// an edit, the Momence webhook's record — for anyone holding the Guests
// page. The floor view refetches on each, so every tablet shows the same
// floor. Client-bundle-safe.

export const FLOOR_TOPIC = 'floor:checkins';
