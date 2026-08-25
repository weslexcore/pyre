// The admin's optional free-text note for a draft run ("give Sarah a shift to
// lead", "Asana + Cortney need training shifts with Wes"). It rides along with
// the drafting instruction sent to the pyre-agents Eve session — one session
// per week, so the same note applies to every week a run targets.

/** Longer than this and it stops being a note; the UI caps at the same size. */
export const MAX_DRAFT_PROMPT_LENGTH = 1000;

/** Control characters that have no business in a note — newlines and tabs stay. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Trim, drop control characters, and neutralise anything that would close the
 * delimiter the note is wrapped in, so a stray `</admin-note>` in the text
 * can't end the block early and read as instructions to the agent.
 */
export function sanitizeDraftPrompt(raw: string): string {
  return raw
    .replace(/<\/?admin-note>?/gi, '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, MAX_DRAFT_PROMPT_LENGTH)
    .trim();
}

/**
 * The message that starts one week's drafting session. `prompt` is the
 * sanitised admin note (empty for a plain draft run).
 */
export function buildDraftMessage(weekStart: string, prompt = ''): string {
  const base =
    `Draft the staffing schedule for the week starting ${weekStart}. ` +
    `Use get_week_context with weekStart "${weekStart}", then save exactly one proposal. ` +
    'Fill only shifts that are still below their staffNeeded count — leave fully staffed ' +
    "shifts untouched, and never add more people than a shift's remaining need. " +
    'Apply every scheduling rule in your instructions — shift-lead coverage, weekly hour ' +
    'targets, and pending shift requests included. ' +
    'Any previous draft for that week is superseded automatically.';

  if (!prompt) return base;

  return (
    `${base}\n\n` +
    'The admin added a note for this draft. Treat it as a high-priority preference for the ' +
    'judgment calls, but the hard rules in your instructions still win — never assign over ' +
    '"busy" availability, never touch covered shifts, never overfill. Open the rationale with ' +
    'a short line on how you handled the note, including anything you could not honour.\n' +
    `<admin-note>\n${prompt}\n</admin-note>`
  );
}
