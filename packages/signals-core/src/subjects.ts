// What the classifier can be asked to read. A "subject" is a kind of record
// whose text we classify — shift notes today. Each entry tells the model what
// it is looking at and which signals make sense for it, and gives the
// integrations app the storage key it files results under
// (public.content_classifications.subject_type).
//
// To classify another kind of record (guest notes, incident narratives,
// lost-and-found entries...):
//   1. add an entry here;
//   2. extend the subject_type check in a new migration and attach the
//      delete-cleanup trigger to its table (see the content_classifications
//      migration for the shift_notes example);
//   3. call scheduleClassification() from the route that writes it, and read
//      results back with loadClassifications() (apps/integrations
//      src/lib/classify).
// The questions put to Jev (./classify) are built from this list.

import { SIGNAL_TYPES, type SignalType } from './signals';

export interface SubjectDefinition {
  /** Stable storage key: lowercase snake_case. */
  key: string;
  /** Human name, singular ("shift note"). */
  label: string;
  /** Who writes it and why, written for the model. */
  context: string;
  /** The signals worth looking for in this kind of text. */
  signals: readonly SignalType[];
}

export const SUBJECT_DEFINITIONS = [
  {
    key: 'shift_note',
    label: 'shift note',
    context:
      'A note a Pyre Sauna staff member wrote during or after their shift, for the admins and the next crew: how the shift went, what broke or ran low, guest moments, questions, and anything worth passing along.',
    signals: SIGNAL_TYPES,
  },
] as const satisfies readonly SubjectDefinition[];

export type SubjectType = (typeof SUBJECT_DEFINITIONS)[number]['key'];

export const SUBJECT_TYPES = SUBJECT_DEFINITIONS.map((d) => d.key) as [
  SubjectType,
  ...SubjectType[],
];

const BY_KEY = new Map<string, SubjectDefinition>(SUBJECT_DEFINITIONS.map((d) => [d.key, d]));

export function isSubjectType(value: unknown): value is SubjectType {
  return typeof value === 'string' && BY_KEY.has(value);
}

export function subjectDefinition(type: SubjectType): SubjectDefinition {
  return BY_KEY.get(type) as SubjectDefinition;
}
