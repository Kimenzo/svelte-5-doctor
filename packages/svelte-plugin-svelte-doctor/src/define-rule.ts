/**
 * defineRule helper — mirrors react-doctor HOW_TO_WRITE_A_RULE.md pattern
 * Create single file src/plugin/rules/<bucket>/<id>.ts with defineRule({ id, category, create })
 * Then `pnpm gen` regenerates rule-registry.ts (see react-doctor docs)
 */
import type { RuleMeta, RuleContext } from "svelte-5-doctor-core";

export interface DefineRuleOptions extends RuleMeta {
  create: (ctx: RuleContext) => void;
}

export const defineRule = (opts: DefineRuleOptions) => opts;
