// Every rule the lint runs, in the order their findings are reported when
// severity ties. Adding a rule is adding a file here and a line below; the
// email prints whatever findings come back.

import { capacityOutlier } from './capacity-outlier';
import { draftSoon } from './draft-soon';
import { duplicate } from './duplicate';
import { horizonShort } from './horizon-short';
import type { LintRule } from './rule';
import { specialEventOverlap } from './special-event-overlap';
import { untagged } from './untagged';

export type { LintRule, RuleContext } from './rule';

export const RULES: readonly LintRule[] = [
  specialEventOverlap,
  untagged,
  draftSoon,
  duplicate,
  capacityOutlier,
  horizonShort,
];
