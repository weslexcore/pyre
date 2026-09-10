// Every rule kind the lint knows, built-in and custom. Adding a kind is
// adding a file here and a line below; the admin page renders its settings
// from `fields`, registry.ts validates against them, and the email prints
// whatever findings come back.

import type { RuleKind } from '../types';
import { capacityOutlier } from './capacity-outlier';
import { draftSoon } from './draft-soon';
import { duplicate } from './duplicate';
import { durationVariants } from './duration-variants';
import { expectedCapacity } from './expected-capacity';
import { horizonShort } from './horizon-short';
import { openingHours } from './opening-hours';
import { requiredTag } from './required-tag';
import type { RuleDefinition } from './rule';
import { specialEventOverlap } from './special-event-overlap';
import { untagged } from './untagged';

export type { RuleContext, RuleDefinition, RuleFinding } from './rule';

// The built-ins in the order their findings are reported when severity ties.
// biome-ignore lint/suspicious/noExplicitAny: the registry erases each definition's params type; registry.ts re-validates against `fields`
export const DEFINITIONS: readonly RuleDefinition<any>[] = [
  specialEventOverlap,
  untagged,
  draftSoon,
  duplicate,
  capacityOutlier,
  horizonShort,
  openingHours,
  requiredTag,
  expectedCapacity,
  durationVariants,
];

export const BUILT_IN_DEFINITIONS = DEFINITIONS.filter((d) => d.builtIn);
export const CUSTOM_DEFINITIONS = DEFINITIONS.filter((d) => !d.builtIn);

export function definitionFor(kind: string): RuleDefinition | undefined {
  return DEFINITIONS.find((d) => d.kind === kind);
}

export function isRuleKind(value: unknown): value is RuleKind {
  return typeof value === 'string' && DEFINITIONS.some((d) => d.kind === value);
}
