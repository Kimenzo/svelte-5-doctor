import type { Diagnostic, JsonReport } from "./schemas.js";

export interface ProjectInfo {
  directory: string;
  svelteVersion: string;
  svelteKitVersion: string;
  isSvelteKit: boolean;
  isSvelteKit3: boolean;
  hasTypeScript: boolean;
  framework: "svelte5" | "sveltekit" | "svelte4" | "unknown";
  runesMode: boolean;
}

export interface InspectInput {
  directory: string;
  scope?: "full" | "changed" | "files";
  categories?: string[];
  verbose?: boolean;
  json?: boolean;
  diffBase?: string;
}

export interface InspectResult {
  jsonReport: JsonReport;
  diagnostics: Diagnostic[];
  projectInfo: ProjectInfo;
}

export interface RuleMeta {
  id: string;
  category: import("./schemas.js").Category;
  severity: import("./schemas.js").Severity;
  description: string;
  fix?: string;
  tags?: string[];
  framework?: "svelte5" | "sveltekit" | "global";
}

export interface RuleContext {
  filePath: string;
  source: string;
  ast: unknown;
  diagnostics: Diagnostic[];
  report: (d: Omit<Diagnostic, "filePath">) => void;
}

export type RuleVisitor = (ctx: RuleContext) => void | Promise<void>;
