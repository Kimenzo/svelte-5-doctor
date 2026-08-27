/**
 * Scoring — ported from react-doctor-source/packages/core/src/calculate-score.ts
 * React Doctor: weighted by severity (errors > warnings), deterministic 0-100.
 * Svelte Doctor: same algorithm, adapted weights.
 */
import { SCORE_BANDS, SCORE_WEIGHTS } from "./constants.js";
import type { Diagnostic } from "./schemas.js";

export const calculateScore = (diagnostics: Diagnostic[]): number => {
  let penalty = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") penalty += SCORE_WEIGHTS.ERROR;
    else if (d.severity === "warn") penalty += SCORE_WEIGHTS.WARN;
  }
  return Math.max(0, 100 - penalty);
};

export const getScoreLabel = (score: number): "Great" | "Needs work" | "Critical" => {
  if (score >= SCORE_BANDS.GREAT_THRESHOLD) return "Great";
  if (score >= SCORE_BANDS.NEEDS_WORK_THRESHOLD) return "Needs work";
  return "Critical";
};

export const summarizeDiagnostics = (diagnostics: Diagnostic[]) => {
  const byCategory: Record<string, number> = {
    Security: 0,
    Performance: 0,
    Correctness: 0,
    Accessibility: 0,
    Maintainability: 0,
    Architecture: 0,
  };
  let errors = 0;
  let warnings = 0;
  const files = new Set<string>();
  const rules = new Set<string>();

  for (const d of diagnostics) {
    byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    if (d.severity === "error") errors++;
    else if (d.severity === "warn") warnings++;
    files.add(d.filePath);
    rules.add(d.ruleId);
  }

  return {
    total: diagnostics.length,
    errors,
    warnings,
    byCategory: byCategory as Record<import("./schemas.js").Category, number>,
    affectedFiles: files.size,
    distinctRules: rules.size,
  };
};
