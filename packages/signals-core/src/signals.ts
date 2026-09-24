// What the classifier looks for. Each entry is one kind of "signal" a piece of
// staff-written text can carry — something we need to do, a question someone
// is waiting on, a record that needs changing — and this list is the single
// source of truth for all of it:
//
//   * the agents app builds the classifier's system prompt from the
//     definitions below and its save tool only accepts these keys;
//   * the integrations app validates what the agent sends back against the
//     same keys and labels the chips it draws with the same labels.
//
// To detect something new, add an entry here (key, label, definition, and a
// couple of examples). Nothing else has to change for it to be detected,
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
}

export const SIGNAL_DEFINITIONS = [
  {
    key: 'action',
    label: 'Action',
    definition:
      'Something someone needs to do: a repair, a restock, a follow-up with a guest, a task handed to the next shift or to an admin.',
    examples: [
      'We are down to the last box of eucalyptus oil.',
      'The left cold tub filter needs replacing before Saturday.',
      'Guest left a voicemail about a refund — someone should call her back.',
    ],
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
  },
  {
    key: 'update',
    label: 'Update',
    definition:
      'A record or reference that is now wrong or out of date and should be changed: an SOP, the schedule, a price, the website, inventory counts, a guest profile.',
    examples: [
      'The closing checklist still says to drain the right tub, but we stopped doing that.',
      'The website lists the wrong hours for Sunday.',
    ],
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

/** One thing the classifier found in a piece of text. */
export interface Signal {
  type: SignalType;
  /** One line in plain words: what needs doing, answering, changing, or knowing. */
  summary: string;
}
