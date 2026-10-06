// Size bounds for the SOP writing assistant, shared by the API route
// (lib/sops/assist, server-only) and the editor's chat (./assist-chat).
// Client-bundle-safe.

/** Rough notes are a page or two of typing, not a document dump. */
export const MAX_ASSIST_NOTES = 20_000;

/** A refine call's chat: a working session, not a transcript. */
export const MAX_ASSIST_CHAT_MESSAGES = 60;
export const MAX_ASSIST_CHAT_TEXT = 4_000;
