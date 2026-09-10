// Custom rule: sessions of one type and length must have exactly this
// capacity. The built-in outlier rule infers the norm from the siblings; this
// one is for when the right number is known and a whole week created with
// the wrong one should still be caught.

import { type NormalizedSession, toRef } from '../feed';
import { typeLabel } from '../labels';
import type { RuleDefinition, RuleFinding } from './rule';

export interface ExpectedCapacityParams extends Record<string, unknown> {
  type: string;
  durationMinutes: number;
  capacity: number;
}

export const expectedCapacity: RuleDefinition<ExpectedCapacityParams> = {
  kind: 'expected-capacity',
  title: 'Expected capacity',
  description: 'Sessions of one type and length must have exactly this capacity.',
  builtIn: false,
  defaults: { type: 'open hours', durationMinutes: 60, capacity: 12 },
  fields: [
    { key: 'type', label: 'Session type', type: 'type' },
    { key: 'durationMinutes', label: 'Length (minutes)', type: 'number', min: 5, max: 24 * 60 },
    { key: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 1000 },
  ],
  run(sessions: NormalizedSession[], _ctx, { type, durationMinutes, capacity }): RuleFinding[] {
    return sessions
      .filter(
        (s) =>
          s.isPublished &&
          !s.isSpecialEvent &&
          s.type === type &&
          s.durationMinutes === durationMinutes &&
          s.capacity !== null &&
          s.capacity !== capacity
      )
      .sort((a, b) => a.start - b.start || a.id - b.id)
      .map((s) => ({
        rule: 'expected-capacity',
        severity: 'fix',
        key: `expected-capacity:${s.id}:${s.capacity}`,
        session: toRef(s),
        message: `Capacity ${s.capacity}; ${durationMinutes}-minute ${typeLabel(type)} sessions should be ${capacity}`,
      }));
  },
};
