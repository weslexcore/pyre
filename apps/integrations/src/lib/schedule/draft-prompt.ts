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

/** Shared instruction for a refinement turn, live session or fresh. */
function refineInstruction(weekStart: string): string {
  return (
    `The admin reviewed your current draft for the week starting ${weekStart} and wants ` +
    `changes. Call get_week_context again with weekStart "${weekStart}" before doing anything ` +
    'else — items may have been accepted, rejected, or edited since your last draft, and ' +
    'accepted items are now live assignments you must schedule around, never re-propose. ' +
    'Apply the requested changes, keep everything else from your previous draft stable, and ' +
    'call save_proposal once with the FULL updated assignment set — it supersedes the prior ' +
    'draft automatically, so a partial set would silently drop the rest. The hard rules in ' +
    'your instructions still win over the note. Open the rationale with a short ' +
    '"What changed:" line.'
  );
}

/**
 * The follow-up message for a still-resumable Eve session: the agent already
 * has the drafting conversation in its history. `prompt` is the sanitised
 * refinement note.
 */
export function buildRefineMessage(weekStart: string, prompt: string): string {
  return `${refineInstruction(weekStart)}\n<admin-note>\n${prompt}\n</admin-note>`;
}

/** Thread messages replayed into a fresh session (see buildRefineFallbackMessage). */
export interface DraftThreadMessage {
  role: 'admin' | 'agent';
  content: string;
}

/** Replay at most this many prior messages into a fresh session. */
const MAX_REPLAYED_MESSAGES = 6;
/** Cap each replayed message so old rationales can't crowd out the request. */
const MAX_REPLAYED_MESSAGE_LENGTH = 2000;

/**
 * The opening message for a FRESH session refining an existing draft — used
 * when the original drafting session is gone (expired, or a cron draft whose
 * schedule-triggered session already completed). Replays a capped transcript
 * of the prior thread so the new session has the conversation context.
 */
export function buildRefineFallbackMessage(
  weekStart: string,
  prompt: string,
  priorThread: DraftThreadMessage[]
): string {
  const replayed = priorThread.slice(-MAX_REPLAYED_MESSAGES).map((m) => {
    const label = m.role === 'admin' ? 'Admin' : 'You (previous draft rationale)';
    const content =
      m.content.length > MAX_REPLAYED_MESSAGE_LENGTH
        ? `${m.content.slice(0, MAX_REPLAYED_MESSAGE_LENGTH)}…`
        : m.content;
    return `${label}:\n${content}`;
  });
  const transcript =
    replayed.length > 0
      ? 'Your original drafting session is no longer available, so here is the conversation ' +
        'so far (the current draft on the board came from your last rationale below):\n\n' +
        `${replayed.join('\n\n---\n\n')}\n\n`
      : 'Your original drafting session is no longer available. The current draft for this ' +
        'week is already on the board.\n\n';

  return `${transcript}${refineInstruction(weekStart)}\n<admin-note>\n${prompt}\n</admin-note>`;
}
