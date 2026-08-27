/**
 * Schemas — ported from @react-doctor/core/schemas.ts
 * Design source: react-doctor-source/packages/core/src/schemas.ts
 * Adapted for Svelte 5: categories aligned to Svelte compiler diagnostics.
 */

export type Severity = "error" | "warn" | "off";
export type Category = "Security" | "Performance" | "Correctness" | "Accessibility" | "Maintainability" | "Architecture";

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  category: Category;
  message: string;
  filePath: string;
  line: number;
  column: number;
  fix?: string;
  tags?: string[];
}

export interface SkippedCheckReason {
  ruleId: string;
  reason: string;
}

export interface JsonReport {
  schemaVersion: 3;
  score: number;
  label: "Great" | "Needs work" | "Critical";
  diagnostics: Diagnostic[];
  skippedCheckReasons?: SkippedCheckReason[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    byCategory: Record<Category, number>;
    affectedFiles: number;
    distinctRules: number;
  };
  meta: {
    svelteVersion: string;
    scannedAt: string;
    directory: string;
    durationMs: number;
  };
}

export const buildDiagnosticIdentity = (d: Diagnostic): string =>
  `${d.ruleId}:${d.filePath}:${d.line}:${d.column}:${d.message}`;
