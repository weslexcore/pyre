// Client-bundle-safe constants for the Ask box (the server-side scope module
// imports the staff table and must stay out of the island).

/** Longer than this and it stops being a question; the API caps at the same size. */
export const MAX_QUESTION_LENGTH = 600;
