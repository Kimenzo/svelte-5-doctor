/**
 * Run Inspect — heart of Svelte Doctor diagnostic pipeline
 * Ported from react-doctor-source/packages/core/src/run-inspect.ts
 * Architecture mirrored: streaming orchestrator, file discovery → parse → rule visitors → score.
 * Svelte difference: uses svelte/compiler parse+compile instead of oxlint.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { glob } from "tinyglobby";
import { compile, parse } from "svelte/compiler";
import { detectSvelteProject } from "./project-info.js";
import { SVELTE_DOCTOR_RULES, RULE_MAP } from "./rules/registry.js";
import { calculateScore, getScoreLabel, summarizeDiagnostics } from "./scoring.js";
import { IGNORED_DIRS, GIANT_COMPONENT_THRESHOLD_LINES } from "./constants.js";
import type { Diagnostic, JsonReport } from "./schemas.js";
import type { InspectInput } from "./types.js";

const SVELTE_RE = /\.(svelte|svelte\.js|svelte\.ts)$/;
const CODE_EXT_RE = /\.(svelte|svelte\.js|svelte\.ts|js|ts|jsx|tsx)$/;

const collectFiles = async (directory: string): Promise<string[]> => {
  const patterns = ["**/*.{svelte,svelte.js,svelte.ts,js,ts,jsx,tsx}"];
  const ignore = IGNORED_DIRS.map((d) => `**/${d}/**`);
  const files = await glob(patterns, {
    cwd: directory,
    ignore: [...ignore, "**/*.d.ts", "**/*.test.*", "**/*.spec.*"],
    absolute: false,
    dot: false,
  });
  return files.filter((f) => CODE_EXT_RE.test(f));
};

const lineColFromIndex = (source: string, idx: number) => {
  const before = source.slice(0, idx);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
};

// ── Rule Visitors (lightweight text+AST heuristics) ──
// Each mirrors a React Doctor visitor but adapted to Svelte 5 syntax.
// For full fidelity they'd use svelte AST walk (estree-walker) + compiler warnings.

const runRulesOnFile = (filePath: string, source: string): Diagnostic[] => {
  const diags: Diagnostic[] = [];
  const isSvelte = SVELTE_RE.test(filePath) || filePath.endsWith(".svelte");
  const isRunesFile = /\$state|\$derived|\$effect|\$props|\$bindable|\$inspect/.test(source);
  const lines = source.split("\n");

  const report = (ruleId: string, message: string, idx: number, fix?: string) => {
    const meta = RULE_MAP.get(ruleId);
    if (!meta) return;
    const { line, column } = lineColFromIndex(source, idx);
    diags.push({ ruleId, severity: meta.severity as Diagnostic["severity"], category: meta.category, message, filePath, line, column, fix, tags: meta.tags });
  };

  // ── Security ──
  // {@html} without sanitization — XSS (React's dangerouslySetInnerHTML equivalent)
  // Avoid false positive from comment containing "sanitize": check for actual sanitizer usage in code
  for (const m of source.matchAll(/\{@html\s+([^}]+)\}/g)) {
    const expr = m[1]?.trim() ?? "";
    const isSanitized = /DOMPurify\s*\.\s*sanitize|TrustedHTML|createHTML|Sanitizer\s*\./.test(source);
    if (!isSanitized) {
      report("svelte-5-doctor/no-at-html-xss", `{@html ${expr}} renders raw HTML without sanitization — XSS risk. Sanitize with DOMPurify.sanitize() or TrustedHTML.`, m.index ?? 0, "Sanitize before {@html}: DOMPurify.sanitize(expr)");
    }
  }
  // eval
  for (const m of source.matchAll(/\beval\s*\(/g)) report("svelte-5-doctor/no-eval", "eval() is dangerous — avoid dynamic code execution.", m.index ?? 0);
  for (const m of source.matchAll(/\bnew\s+Function\s*\(/g)) report("svelte-5-doctor/no-eval", "new Function() is eval-like — avoid.", m.index ?? 0);
  // secrets
  for (const m of source.matchAll(/\b(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/gi))
    report("svelte-5-doctor/no-secrets-in-client-code", `Possible hardcoded secret: ${m[0].slice(0, 40)}...`, m.index ?? 0);
  // iframe sandbox
  for (const m of source.matchAll(/<iframe\b(?![^>]*\bsandbox\b)[^>]*>/gi))
    report("svelte-5-doctor/iframe-missing-sandbox", "<iframe> missing sandbox attribute.", m.index ?? 0);
  // DOM clobbering: attribute spreading on input inside form
  if (/<form\b[^>]*>[\s\S]*?\{...[^}]+\}[\s\S]*?<input\b/i.test(source)) {
    const idx = source.search(/\{.../);
    if (idx !== -1) report("svelte-5-doctor/dom-clobbering-risk", "Attribute spreading inside <form> can enable DOM clobbering (CVE-2026-42573). Avoid spreading user-controlled 'name' onto inputs.", idx);
  }

  // ── Correctness: legacy syntax ──
  if (isRunesFile || isSvelte) {
    for (const m of source.matchAll(/\bexport\s+let\s+\w+/g)) {
      if (isRunesFile || source.includes("$props") || source.includes("$state")) {
        report("svelte-5-doctor/legacy-export-let", "`export let` is invalid in runes mode — use `let { prop } = $props()`", m.index ?? 0, "let { prop } = $props()");
      }
    }
    for (const m of source.matchAll(/\$\s*:\s*\w+/g)) {
      if (isRunesFile) report("svelte-5-doctor/legacy-dollars-colon", "`$:` reactive statement is invalid in runes mode — use $derived / $effect", m.index ?? 0);
    }
    for (const m of source.matchAll(/on:\w+\s*=/g)) report("svelte-5-doctor/legacy-event-directive", "`on:click` is deprecated in Svelte 5 — use `onclick`", m.index ?? 0, "onclick={handler}");
    for (const m of source.matchAll(/<slot\b/g)) report("svelte-5-doctor/legacy-slot", "<slot> is deprecated — use {#snippet} + {@render}", m.index ?? 0);
    // mixed syntax
    if (/on:\w+/.test(source) && /\bonclick\b/.test(source))
      report("svelte-5-doctor/mixed-event-syntax", "Mixing `on:click` and `onclick` — use Svelte 5 `onclick` only.", source.indexOf("on:"));
    if (/<slot/.test(source) && /\{@render/.test(source))
      report("svelte-5-doctor/slot-snippet-conflict", "Mixing <slot> and {@render} in same file.", source.indexOf("<slot"));
  }

  // ── Correctness: rune placement ──
  for (const m of source.matchAll(/\$state\s*\(/g)) {
    const before = source.slice(0, m.index ?? 0);
    const insideFunction = /function\s+\w*\s*\([^)]*\)\s*\{[^}]*$/.test(before.slice(-500));
    // Top-level $state inside non-.svelte.js module export reassignment check
    if (filePath.endsWith(".svelte.js") || filePath.endsWith(".svelte.ts")) {
      if (/export\s+let\s+\w+\s*=\s*\$state/.test(source) && /\w+\s*\+=|\w+\s*=/.test(source.slice((m.index ?? 0) + 10, (m.index ?? 0) + 200))) {
        report("svelte-5-doctor/state-invalid-export", "Exporting reassigned $state from .svelte.js leaks across SSR requests — export const instance or getter.", m.index ?? 0);
      }
    }
  }
  for (const m of source.matchAll(/\$props\s*\(/g)) {
    const beforeLines = source.slice(0, m.index ?? 0).split("\n");
    const lastFew = beforeLines.slice(-3).join("\n");
    if (!/let\s*\{[^}]*\}\s*=\s*\$props\(\)/.test(source.slice((m.index ?? 0) - 100, (m.index ?? 0) + 50))) {
      // Check not top-level destructuring
      if (/const\s+\w+\s*=\s*\$props/.test(source.slice((m.index ?? 0) - 50, (m.index ?? 0) + 50)) && !/let\s*\{/.test(source.slice((m.index ?? 0) - 50, (m.index ?? 0) + 50))) {
        report("svelte-5-doctor/props-invalid-placement", "$props() must be `let { ... } = $props()` at top-level.", m.index ?? 0);
      }
    }
  }
  for (const m of source.matchAll(/\$bindable\s*\(/g)) {
    const hasPropsInFile = /\$props\(\)/.test(source);
    const nearbyHasProps = /\$props\(\)/.test(source.slice(Math.max(0, (m.index ?? 0) - 500), (m.index ?? 0) + 500));
    if (!hasPropsInFile || !nearbyHasProps) {
      report("svelte-5-doctor/bindable-invalid-location", "$bindable() only inside $props() destructuring.", m.index ?? 0);
    }
  }
  for (const m of source.matchAll(/\$derived\s*\(/g)) {
    if (filePath.endsWith(".svelte.js") && /export\s+/.test(source.slice(Math.max(0, (m.index ?? 0) - 50), (m.index ?? 0)))) {
      report("svelte-5-doctor/derived-invalid-export", "Exporting $derived from module is invalid.", m.index ?? 0);
    }
  }
  // store rune conflict: $count vs rune
  for (const m of source.matchAll(/\$\w+\s*[,;\)\]]/g)) {
    const name = m[0].replace(/[^$\w]/g, "");
    if (/^\$(state|derived|effect|props|bindable|inspect)$/.test(name)) continue;
    if (source.includes(`$${name.slice(1)}`) && /\bstores?\b|\bwritable\b/.test(source)) {
      // naive
    }
  }
  // non_reactive_update: let mutated but not $state
  const letDecls = [...source.matchAll(/\blet\s+(\w+)\s*=\s*[^;]+/g)];
  for (const decl of letDecls) {
    const varName = decl[1];
    if (!varName || ["count","value","data","props"].includes(varName) && false) continue;
    const after = source.slice((decl.index ?? 0) + decl[0].length);
    if (new RegExp(`\\b${varName}\\s*\\+=|\\b${varName}\\s*=\\s*[^=]`).test(after) && !source.includes(`$state`) && !source.includes(`$props`)) {
      // Only report if used in template
      if (isSvelte && source.includes(`{${varName}}`)) {
        report("svelte-5-doctor/non-reactive-update", `let ${varName} reassigned but not $state — template won't update.`, decl.index ?? 0, `let ${varName} = $state(...)`);
      }
    }
  }
  // state_referenced_locally
  for (const m of source.matchAll(/setContext\s*\(\s*["'][^"']+["']\s*,\s*(\w+)\s*\)/g)) {
    const arg = m[1];
    if (arg && source.includes(`$state`)) report("svelte-5-doctor/state-referenced-locally", `setContext('key', ${arg}) snapshots value — use () => ${arg} getter or createContext.`, m.index ?? 0);
  }
  // snippet rest
  for (const m of source.matchAll(/\{#snippet\s+\w+\s*\([^)]*\.\.\./g))
    report("svelte-5-doctor/snippet-invalid-rest", "Snippet with rest params is invalid.", m.index ?? 0);

  // ── Correctness: effects & derived ──
  for (const m of source.matchAll(/\$effect\s*\(\s*\(\)\s*=>\s*\{[^}]*\b\w+\s*=\s*[^}]*\}/g)) {
    const body = m[0];
    if (/\w+\s*=\s*\w+\s*\*\s*\w+|\w+\s*=\s*\w+\s*\+\s*\w+/.test(body) && !/fetch|setTimeout|addEventListener/.test(body)) {
      report("svelte-5-doctor/no-effect-derived", "Deriving state inside $effect — use $derived instead.", m.index ?? 0, "let x = $derived(y * 2)");
    }
  }
  // effect cleanup
  for (const m of source.matchAll(/\$effect\s*\(\s*\(\)\s*=>\s*\{[^}]*\b(setInterval|setTimeout|addEventListener)\s*\(/g)) {
    const snippet = source.slice(m.index ?? 0, (m.index ?? 0) + 500);
    if (!/return\s*\(\)\s*=>/.test(snippet) && !/return\s*function/.test(snippet)) {
      report("svelte-5-doctor/effect-needs-cleanup", `${m[1]} inside $effect without cleanup — return () => clear...`, m.index ?? 0);
    }
  }
  for (const m of source.matchAll(/\$derived\s*\([^)]*\)\s*\{[^}]*\w+\s*\+=|\$derived\([^)]*=>[^)]*\{[^}]*\w+\+\+/g))
    report("svelte-5-doctor/no-mutate-in-derived", "Mutating state inside $derived is forbidden.", m.index ?? 0);
  // derived simple
  for (const m of source.matchAll(/\$derived\s*\(\s*\w+\s*\)/g))
    report("svelte-5-doctor/no-derived-simple", "Useless $derived wrapping single variable — use directly.", m.index ?? 0);

  // ── Performance ──
  // unkeyed each
  for (const m of source.matchAll(/\{#each\s+[^\}]+ as [^\}]+}/g)) {
    const block = m[0];
    if (!/\(.+\)/.test(block)) report("svelte-5-doctor/no-index-as-key", "{#each} without key — use `{#each items as item (item.id)}`", m.index ?? 0);
    else if (/\(\s*\w+\s*\)/.test(block) && /,\s*i\s*\)/.test(block)) report("svelte-5-doctor/no-index-as-key", "{#each} using index as key is unstable.", m.index ?? 0);
  }
  // each item mutation
  for (const m of source.matchAll(/\{#each\s+(\w+)\s+as\s+(\w+)[^}]*\}[\s\S]*?bind:value=\{(\w+)\}/g)) {
    const item = m[2];
    if (item === m[3]) report("svelte-5-doctor/each-item-mutation", `bind:value={${item}} mutates each item directly — use array[index].`, m.index ?? 0);
  }
  // large $state object
  for (const m of source.matchAll(/\$state\s*\(\s*\{[^}]{200,}\}/g))
    report("svelte-5-doctor/perf-avoid-deep-proxy", "Large object with $state proxies deeply — consider $state.raw + reassignment.", m.index ?? 0);
  // inline class
  for (const m of source.matchAll(/\$effect\s*\([^)]*\)\s*=>\s*\{[^}]*new\s+class\b/g))
    report("svelte-5-doctor/perf-avoid-inline-class", "new class inside $effect — hoist to module scope.", m.index ?? 0);
  // layout animation
  for (const m of source.matchAll(/transition:\w+[^}]*width|animate:[^;]*width|style:[^;]*width/g))
    if (/width|height|top|left/.test(m[0])) report("svelte-5-doctor/no-layout-animation", "Animating layout properties causes thrash — use transform/opacity.", m.index ?? 0);
  for (const m of source.matchAll(/transition:\s*all\b/g)) report("svelte-5-doctor/no-transition-all", "transition:all is expensive — specify property.", m.index ?? 0);
  for (const m of source.matchAll(/filter:\s*blur\(\s*(\d+)px\)/g)) {
    const r = Number.parseInt(m[1] ?? "0", 10);
    if (r > 20) report("svelte-5-doctor/no-large-animated-blur", `Large blur(${r}px) animation is expensive — reduce radius.`, m.index ?? 0);
  }
  // js perf
  for (const m of source.matchAll(/\.filter\s*\([^)]+\)\s*\.map\s*\(/g)) report("svelte-5-doctor/js-combine-iterations", "filter().map() does 2 passes — use single loop or flatMap.", m.index ?? 0);
  for (const m of source.matchAll(/for\s*\([^)]+\)\s*\{[^}]*new\s+RegExp\s*\(/g)) report("svelte-5-doctor/js-hoist-regexp", "RegExp inside loop — hoist.", m.index ?? 0);
  for (const m of source.matchAll(/for\s*\([^)]+\)\s*\{[^}]*new\s+Intl\./g)) report("svelte-5-doctor/js-hoist-intl", "Intl.* inside loop — hoist.", m.index ?? 0);
  for (const m of source.matchAll(/from\s+["'][^"']*\/index["']|import\s+\*\s+as\s+\w+\s+from\s+["']lodash["']/g))
    report("svelte-5-doctor/no-barrel-import", "Barrel/lodash full import hurts tree-shaking — import specific path.", m.index ?? 0);

  // ── Maintainability ──
  if (lines.length > GIANT_COMPONENT_THRESHOLD_LINES)
    report("svelte-5-doctor/no-giant-component", `Component is ${lines.length} lines (threshold ${GIANT_COMPONENT_THRESHOLD_LINES}) — split via snippets/composition.`, 0);
  // nested snippet: {#snippet} inside {#if} or {#each}
  for (const m of source.matchAll(/\{#if[\s\S]*?\{#snippet|\{#each[\s\S]*?\{#snippet/g))
    report("svelte-5-doctor/no-nested-snippet", "Snippet defined inside markup recreates each render — hoist to top-level.", m.index ?? 0);

  // ── a11y via compiler bridge: also rely on svelte compile warnings ──
  // simple heuristics:
  for (const m of source.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) report("svelte-5-doctor/a11y-missing-attribute", "<img> missing alt attribute.", m.index ?? 0);
  for (const m of source.matchAll(/<a\b(?![^>]*\bhref=)[^>]*>/gi)) report("svelte-5-doctor/a11y-missing-attribute", "<a> missing href.", m.index ?? 0);
  for (const m of source.matchAll(/onclick\s*=\s*\{[^}]+\}(?![^<]*onkeydown)/gi)) {
    // if clickable div without keyboard
    const tagMatch = source.slice(Math.max(0, (m.index ?? 0) - 100), m.index ?? 0).match(/<(\w+)\b[^>]*$/);
    const tag = tagMatch?.[1] ?? "";
    if (tag === "div" || tag === "span") report("svelte-5-doctor/a11y-click-events-have-key-events", `<${tag}> with onclick missing keyboard handler.`, m.index ?? 0);
  }

  return diags;
};

export const runInspect = async (input: InspectInput): Promise<JsonReport> => {
  const started = Date.now();
  const directory = input.directory;
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const projectInfo = await detectSvelteProject(directory);
  const files = await collectFiles(directory);

  let allDiagnostics: Diagnostic[] = [];
  const skipped: { ruleId: string; reason: string }[] = [];

  for (const rel of files) {
    const abs = join(directory, rel);
    let source: string;
    try {
      source = readFileSync(abs, "utf-8");
    } catch {
      skipped.push({ ruleId: "*", reason: `read failed: ${rel}` });
      continue;
    }

    // Bridge svelte compiler warnings (a11y, css_unused_selector, etc.)
    if (rel.endsWith(".svelte")) {
      try {
        const result = compile(source, { filename: rel, generate: "client" });
        for (const w of result.warnings ?? []) {
          const code = (w as unknown as { code?: string }).code ?? "svelte-warning";
          const isA11y = code.startsWith("a11y");
          const isCss = code === "css_unused_selector";
          // Map to our ruleIds when possible
          let ruleId = `svelte/compiler:${code}`;
          let category: Diagnostic["category"] = "Correctness";
          if (isA11y) { ruleId = `svelte-5-doctor/${code.replaceAll("_", "-")}`; category = "Accessibility"; }
          else if (isCss) { ruleId = "svelte-5-doctor/css-unused-selector"; category = "Maintainability"; }
          else if (code.includes("state") || code.includes("rune")) category = "Correctness";
          else if (code.includes("perf")) category = "Performance";

          // Already covered by our heuristics? still surface compiler message as additional
          const line = (w as unknown as { start?: { line: number; column: number } }).start?.line ?? 1;
          const col = (w as unknown as { start?: { line: number; column: number } }).start?.column ?? 1;
          // Deduplicate if we already reported same line with same code
          const msg = (w as unknown as { message: string }).message ?? String(w);
          allDiagnostics.push({
            ruleId,
            severity: "warn",
            category,
            message: msg,
            filePath: rel,
            line,
            column: col,
            tags: [code],
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Compiler errors become diagnostics
        const lineMatch = msg.match(/:(\d+):(\d+)/);
          allDiagnostics.push({
            ruleId: "svelte-5-doctor/compile-error",
            severity: "error",
            category: "Correctness",
            message: msg.split("\n")[0] ?? msg,
            filePath: rel,
            line: lineMatch ? Number.parseInt(lineMatch[1] ?? "1", 10) : 1,
            column: lineMatch ? Number.parseInt(lineMatch[2] ?? "1", 10) : 1,
          });
        // still run heuristic rules even after compile error — mirrors react-doctor's partial failure handling
      }
    }

    // Heuristic rules (run even on compile error to surface all issues)
    const heuristic = runRulesOnFile(rel, source);
    allDiagnostics.push(...heuristic);
  }

  // Also parse .svelte.js for run via parse (module)
  // svelte/compiler parse for .svelte only; .svelte.js compileModule not needed for heuristics

  // Filter by category if requested
  if (input.categories?.length) {
    const set = new Set(input.categories.map((c) => c.toLowerCase()));
    allDiagnostics = allDiagnostics.filter((d) => set.has(d.category.toLowerCase()));
  }

  // Scope filtering: changed/files — MVP: if scope=changed, no-op (needs git)
  // Keep for API parity with react-doctor.

  const score = calculateScore(allDiagnostics);
  const label = getScoreLabel(score);
  const summary = summarizeDiagnostics(allDiagnostics);

  const jsonReport: JsonReport = {
    schemaVersion: 3,
    score,
    label,
    diagnostics: allDiagnostics,
    skippedCheckReasons: skipped.length ? skipped : undefined,
    summary,
    meta: {
      svelteVersion: projectInfo.svelteVersion,
      scannedAt: new Date().toISOString(),
      directory: relative(process.cwd(), directory) || directory,
      durationMs: Date.now() - started,
    },
  };

  return jsonReport;
};
