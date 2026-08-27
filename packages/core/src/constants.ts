/**
 * Constants — ported from react-doctor-source/packages/core/src/constants.ts
 * Adapted for Svelte Doctor. Magic numbers use SCREAMING_SNAKE_CASE with unit suffix.
 */

export const MAX_FILE_SIZE_BYTES = 1_000_000;
export const MAX_DIAGNOSTICS_PER_FILE = 50;
export const GIANT_COMPONENT_THRESHOLD_LINES = 400;
export const GIANT_COMPONENT_THRESHOLD_COMPLEXITY = 300;
export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 1000;
export const TELEMETRY_EXPORT_INTERVAL_MS = 60_000;
export const OXLINT_SPAWN_TIMEOUT_MS = 120_000;

export const SVELTE_EXTENSIONS = [".svelte", ".svelte.js", ".svelte.ts"] as const;
export const JS_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx"] as const;
export const ALL_SCAN_EXTENSIONS = [...SVELTE_EXTENSIONS, ...JS_EXTENSIONS] as const;

export const SCORE_WEIGHTS = {
  ERROR: 15,
  WARN: 5,
} as const;

export const SCORE_BANDS = {
  GREAT_THRESHOLD: 75,
  NEEDS_WORK_THRESHOLD: 50,
} as const;

export const IGNORED_DIRS = ["node_modules", ".git", ".svelte-kit", "dist", "build", ".turbo", ".vercel", ".next", "tests", "__tests__", "benchmarking", ".changeset", "playgrounds", "references", ".obsidian"] as const;

export const SCORE_FAIL_THRESHOLD = 75 as const;
