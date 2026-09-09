import type { NormalizedSession } from '../feed';
import type { Finding, FindingKind } from '../types';

export interface RuleContext {
  now: Date;
  /** ET calendar dates the run covers; `endMs` is exclusive. */
  horizon: { start: string; end: string; endMs: number };
}

/**
 * A rule is a pure function over the normalised feed. It never reads the
 * clock or the network — `ctx.now` is the only "now" — so a run is
 * reproducible from a feed fixture.
 */
export interface LintRule {
  name: FindingKind;
  run(sessions: NormalizedSession[], ctx: RuleContext): Finding[];
}
