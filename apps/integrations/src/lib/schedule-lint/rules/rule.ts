import type { NormalizedSession } from '../feed';
import type { Finding, ParamField, RuleKind } from '../types';

export interface RuleContext {
  now: Date;
  /** ET calendar dates the run covers; `endMs` is exclusive. */
  horizon: { start: string; end: string; endMs: number };
}

/** What a rule reports; lint.ts stamps the instance id and label on top. */
export type RuleFinding = Omit<Finding, 'ruleId' | 'ruleLabel'>;

/**
 * A rule kind: a pure function over the normalised feed plus the settings
 * that shape it. It never reads the clock or the network — `ctx.now` is the
 * only "now" — so a run is reproducible from a feed fixture.
 *
 * `fields` is what the admin page renders for the settings and what
 * registry.ts validates against; `defaults` is what a built-in runs with
 * until someone changes it, and what a new custom rule's form starts from.
 */
export interface RuleDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  kind: RuleKind;
  /** The built-in's label, or the template name a custom rule is added as. */
  title: string;
  description: string;
  builtIn: boolean;
  defaults: P;
  fields: ParamField[];
  run(sessions: NormalizedSession[], ctx: RuleContext, params: P): RuleFinding[];
}
