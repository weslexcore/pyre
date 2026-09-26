// What the classifier looks for. Each entry is one kind of "signal" a piece of
// staff-written text can carry — something we need to do, a question someone
// is waiting on, a record that needs changing — and this list is the single
// source of truth for all of it:
//
//   * classifySignals() (./classify) asks Jev (TypeSafe's System One
//     evaluation model) one yes/no question per entry, built from its
//     definition and examples, and keeps the answers at or above the entry's
//     threshold;
//   * the integrations app stores those and labels the chips it draws with
//     the same labels.
//
// To detect something new, add an entry here (key, label, definition, a
// couple of examples, and whether it means work is owed). Nothing else has to change for it to be detected,
// stored, and shown; a filter or badge colour elsewhere is optional polish.
// Removing or renaming a key orphans rows already stored under it — the
// integrations app drops unknown keys when it reads them back, so prefer
// retiring a key over reusing it for something different.

export interface SignalDefinition {
  /** Stable storage key: lowercase snake_case, never reused for a different meaning. */
  key: string;
  /** Short label for chips and filters. */
  label: string;
  /** What counts, written for the model: one or two sentences. */
  definition: string;
  /** A few short, realistic snippets that carry this signal. */
  examples: readonly string[];
  /**
   * What the model must not mistake for it: when this signal does NOT hold,
   * and a few look-alike snippets that don't carry it (the classifier's
   * "false" criterion). Optional; without it the model only hears "nothing
   * in the text is a <label>".
   */
  notThis?: { means: string; examples: readonly string[] };
  /**
   * Whether this signal means someone owes work on the text: an answer, a
   * fix, a change, a follow-up. A record carrying any actionable signal goes
   * on the to-do list; one carrying none is informational and can be closed
   * out (the integrations app triages shift notes this way).
   */
  actionable: boolean;
  /**
   * The probability at or above which the text counts as carrying it.
   * Defaults to DEFAULT_SIGNAL_THRESHOLD; raise it for a signal that fires
   * too eagerly, lower it for one that must not be missed.
   */
  threshold?: number;
}

/** Jev's boolean answers are P(true); a coin flip or better counts by default. */
export const DEFAULT_SIGNAL_THRESHOLD = 0.5;

export const SIGNAL_DEFINITIONS = [
  {
    key: 'action',
    label: 'Action',
    definition:
      'Something someone still needs to do that the text asks for or names: a repair, a restock, a follow-up with a guest, a task handed to the next shift or to an admin. Only outstanding work the writer points to counts, not a follow-up a reader might think up on their own.',
    examples: [
      'We are down to the last box of eucalyptus oil.',
      'The left cold tub filter needs replacing before Saturday.',
      'Guest left a voicemail about a refund — someone should call her back.',
    ],
    // Two look-alikes the model otherwise reads as tasks: a report of work
    // already done ("restocked the towels"), and good news it could imagine
    // a follow-up for ("one potential member") when nobody asked for one.
    notThis: {
      means:
        'Nothing is left for anyone to do. A note saying something was already done — fixed, restocked, written up, called back, handled — is a report of completed work. A note about how the shift went — turnout, a good class, a guest who might join — is a report too; do not invent a follow-up the writer did not ask for. Either is only an action if it also says something still needs doing.',
      examples: [
        'Restocked the towels and eucalyptus oil before close.',
        'Replaced the left cold tub filter this afternoon.',
        'Called the guest back about her refund; it is sorted.',
        'Wrote up a checklist for private events and put it in the SOP folder.',
        'Busy social tonight, great energy, and a couple of guests seemed keen on memberships.',
      ],
    },
    actionable: true,
  },
  {
    key: 'question',
    label: 'Question',
    definition:
      'A question the writer (or a guest they are relaying) wants answered by an admin or the team.',
    examples: [
      'Are we still doing the Tuesday silent session next month?',
      'A guest asked whether memberships can be paused — can they?',
    ],
    actionable: true,
  },
  {
    key: 'update',
    label: 'Update',
    definition:
      'A record or reference that is now wrong or out of date and still needs to be changed: an SOP, the schedule, a price, the website, inventory counts, a guest profile.',
    examples: [
      'The closing checklist still says to drain the right tub, but we stopped doing that.',
      'The website lists the wrong hours for Sunday.',
    ],
    notThis: {
      means:
        'No record is left out of date. A note saying a record was already corrected is a report of completed work, not an update to make.',
      examples: [
        'Fixed the Sunday hours on the website.',
        'Updated the closing checklist to drop the right tub drain.',
      ],
    },
    actionable: true,
  },
  {
    key: 'feedback',
    label: 'Feedback',
    definition:
      'Guest or staff feedback worth passing along — a complaint, a compliment, or a suggestion about the experience.',
    examples: [
      'Two guests said the music was too loud during the silent session.',
      'Regular said the new towels are great.',
    ],
    // Worth reading, not a task by itself: feedback that needs a fix or a
    // reply also reads as an action or a question.
    actionable: false,
  },
  {
    key: 'safety',
    label: 'Safety',
    definition:
      'An injury, medical event, near miss, or hazard to guests or staff — anything that might need an incident report or urgent attention.',
    examples: [
      'Guest felt faint after the third round and sat out with water.',
      'The step into the plunge is cracked and a bit sharp.',
    ],
    actionable: true,
    // A missed safety note costs more than a spurious chip.
    threshold: 0.35,
  },
] as const satisfies readonly SignalDefinition[];

export type SignalType = (typeof SIGNAL_DEFINITIONS)[number]['key'];

/** Every signal key, in registry order (the order chips and filters show them). */
export const SIGNAL_TYPES = SIGNAL_DEFINITIONS.map((d) => d.key) as [SignalType, ...SignalType[]];

const BY_KEY = new Map<string, SignalDefinition>(SIGNAL_DEFINITIONS.map((d) => [d.key, d]));

export function isSignalType(value: unknown): value is SignalType {
  return typeof value === 'string' && BY_KEY.has(value);
}

export function signalDefinition(type: SignalType): SignalDefinition {
  return BY_KEY.get(type) as SignalDefinition;
}

export function signalLabel(type: SignalType): string {
  return signalDefinition(type).label;
}

export function signalThreshold(type: SignalType): number {
  return signalDefinition(type).threshold ?? DEFAULT_SIGNAL_THRESHOLD;
}

export function isActionableSignal(type: SignalType): boolean {
  return signalDefinition(type).actionable;
}

/**
 * Whether a set of found signals leaves anyone work to do (any actionable
 * signal), or the text is purely informational (none, or only ones like
 * feedback that are worth reading but not a task).
 */
export function hasActionableSignal(signals: readonly Pick<Signal, 'type'>[]): boolean {
  return signals.some((s) => isActionableSignal(s.type));
}

/** One kind of signal the classifier found in a piece of text. */
export interface Signal {
  type: SignalType;
  /** Jev's estimate, in [0, 1], that the text carries this signal. */
  probability: number;
}
