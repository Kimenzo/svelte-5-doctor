/**
 * Run Inspect — heart of Svelte Doctor diagnostic pipeline
 * Ported from react-doctor-source/packages/core/src/run-inspect.ts
 * Perfection 2026-08-27: Svelte 5.56.10, 71 rules, 21 high-priority + 5 Kit
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { glob } from "tinyglobby";
import { compile, parse } from "svelte/compiler";
import { walk } from "estree-walker";
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
    ignore: [...ignore, "**/*.d.ts", "**/*.test.*", "**/*.spec.*", "**/*.min.js", "**/*.min.css"],
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

const runRulesOnFile = (filePath: string, source: string, directory?: string): Diagnostic[] => {
  const diags: Diagnostic[] = [];
  const isSvelte = SVELTE_RE.test(filePath) || filePath.endsWith(".svelte");
  const isRunesFile = /\$state|\$derived|\$effect|\$props|\$bindable|\$inspect/.test(source);
  const lines = source.split("\n");

  const sourceNoComments = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const report = (ruleId: string, message: string, idx: number, fix?: string) => {
    const meta = RULE_MAP.get(ruleId);
    if (!meta) return;
    const { line, column } = lineColFromIndex(source, idx);
    diags.push({ ruleId, severity: meta.severity as Diagnostic["severity"], category: meta.category, message, filePath, line, column, fix, tags: meta.tags });
  };

  // ── helpers for perfection rules ──
  const stateVars = new Set(
    [...source.matchAll(/\b(?:let|const)\s+(\w+)\s*=\s*\$state(?:\.raw)?\s*\(/g)]
      .map((m) => m[1]!)
      .filter(Boolean)
  );
  const rawStateVars = new Set(
    [...source.matchAll(/\b(?:let|const)\s+(\w+)\s*=\s*\$state\.raw\s*\(/g)]
      .map((m) => m[1]!)
      .filter(Boolean)
  );
  const derivedVars = new Set(
    [...source.matchAll(/(?:let|const)\s+(\w+)\s*=\s*\$derived(?:\.by)?\s*\(/g)]
      .map((m) => m[1]!)
      .filter(Boolean)
  );
  // props extraction
  const propsVars: string[] = [];
  const propsFallbackVars: string[] = [];
  for (const m of source.matchAll(/let\s*\{\s*([^}]+)\}\s*=\s*\$props\(\)/g)) {
    const inner = m[1] ?? "";
    for (const part of inner.split(",")) {
      const p = part.trim();
      if (!p) continue;
      if (p.startsWith("...")) continue;
      const nameMatch = p.match(/^(\w+)(?:\s*:\s*\w+)?(?:\s*=\s*(.+))?$/);
      if (nameMatch) {
        const orig = nameMatch[1]!;
        propsVars.push(orig);
        if (nameMatch[2]) {
          // has fallback
          const fb = nameMatch[2].trim();
          if (fb.startsWith("{") || fb.startsWith("[")) propsFallbackVars.push(orig);
        }
      }
      // $bindable detection
      if (p.includes("$bindable")) {
        const b = p.match(/(\w+)\s*=\s*\$bindable/);
        if (b) propsVars.push(b[1]!);
      }
    }
  }
  const bindableVars = new Set(
    [...source.matchAll(/(\w+)\s*=\s*\$bindable\s*\(/g)].map((m) => m[1]!).filter(Boolean)
  );

  // ── AST Walker (svelte/compiler modernAst + estree-walker) — ported from react-doctor oxc-parser flow
  // Replaces regex for TS generics, nested snippets, rune placement with precise AST. See react-doctor-source/packages/core/src/runners/oxlint/compute-ruleset-hash.ts for hashing idea.
  try {
    const ast: unknown = parse(source, { filename: filePath, modernAst: true } as unknown as Record<string, unknown>);
    const root = ast as {
      fragment?: { nodes?: unknown[] };
      instance?: { content?: { body?: unknown[]; type?: string } };
      module?: { content?: { body?: unknown[] } };
    };
    // Walk instance script (runes) with estree-walker — handles TS generics via svelte parse (typeScript: true implicit)
    const instanceBody = root.instance?.content?.body ?? [];
    // Track nesting depth to detect nested snippets and inline classes
    let snippetDepth = 0;
    let eachDepth = 0;
    let ifDepth = 0;
    const visitInstance = (nodes: unknown[]) => {
      for (const node of nodes as Array<Record<string, unknown>>) {
        if (!node || typeof node.type !== "string") continue;
        // Rune placement: $state/$derived/$effect/$props/$bindable not at top-level
        if (node.type === "ExpressionStatement" && (node.expression as Record<string, unknown>)?.type === "CallExpression") {
          const callee = (node.expression as Record<string, unknown>).callee as Record<string, unknown> | undefined;
          const name = callee?.type === "Identifier" ? (callee.name as string) : "";
          if (["$state","$derived","$effect","$props","$bindable"].includes(name) && snippetDepth + eachDepth + ifDepth > 0) {
            // nested inside snippet/each/if — likely valid for snippetDepth but $props only top-level
            if (name === "$props") report("svelte-5-doctor/props-invalid", "`$props()` inside nested snippet/each/if — must be top-level", (node.start as number) ?? 0);
          }
        }
        // Inline class detection via AST (perf_avoid_inline_class) — more precise than regex, handles TS generics
        if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
          if (eachDepth > 0 || ifDepth > 0 || snippetDepth > 0) {
            report("svelte-5-doctor/perf-avoid-inline-class", "Class declared inside each/if/snippet — hoist to module scope", (node.start as number) ?? 0);
          }
        }
        // Recurse
        for (const key of Object.keys(node)) {
          const val = node[key];
          if (Array.isArray(val)) visitInstance(val as unknown[]);
          else if (val && typeof val === "object" && "type" in (val as Record<string, unknown>)) visitInstance([val]);
        }
      }
    };
    if (instanceBody.length) visitInstance(instanceBody);

    // Fragment walk for nested snippets (estree-walker via manual)
    const fragmentNodes = (root.fragment?.nodes ?? []) as Array<Record<string, unknown>>;
    const walkFragment = (nodes: Array<Record<string, unknown>>, depth: number) => {
      for (const n of nodes) {
        if (!n) continue;
        const t = n.type as string;
        if (t === "SnippetBlock") {
          snippetDepth++;
          if (depth > 0) report("svelte-5-doctor/no-nested-snippet", "Snippet defined inside markup recreates each render — hoist to top-level", (n.start as number) ?? 0);
          const snNodes = (n.body as Record<string, unknown>)?.nodes as Array<Record<string, unknown>> | undefined;
          if (snNodes) walkFragment(snNodes, depth + 1);
          snippetDepth--;
          continue;
        }
        if (t === "EachBlock") {
          eachDepth++;
          const children = (n.body as Record<string, unknown>)?.nodes as Array<Record<string, unknown>> | undefined;
          if (children) walkFragment(children, depth + 1);
          eachDepth--;
          // Check each without key and without as (TS generics case)
          const expr = n.expression as Record<string, unknown> | undefined;
          const ctx = n.context as Record<string, unknown> | undefined;
          if (!n.key && ctx) {
            // Svelte 5 modernAst: EachBlock has key, expression, context
            report("svelte-5-doctor/no-index-as-key", "{#each} without key — use (item.id) — also handles TS generics", (n.start as number) ?? 0);
          }
          continue;
        }
        if (t === "IfBlock") {
          ifDepth++;
          const branches = [n.consequent, n.alternate].filter(Boolean) as Array<Record<string, unknown>>;
          for (const br of branches) {
            const brNodes = (br.nodes ?? br.children) as Array<Record<string, unknown>> | undefined;
            if (brNodes) walkFragment(brNodes, depth + 1);
          }
          ifDepth--;
          continue;
        }
        // generic children
        const children = (n.fragment as Record<string, unknown>)?.nodes as Array<Record<string, unknown>> | undefined;
        if (children) walkFragment(children, depth);
        else if (Array.isArray((n as Record<string, unknown>).nodes)) walkFragment((n as Record<string, unknown>).nodes as Array<Record<string, unknown>>, depth);
      }
    };
    if (fragmentNodes.length) walkFragment(fragmentNodes, 0);
  } catch {
    // parse failed — compile step will already report svelte-5-doctor/compile-error, keep heuristic fallback
  }

  // ── Security ──
  for (const m of source.matchAll(/\{@html\s+([^}]+)\}/g)) {
    const expr = m[1]?.trim() ?? "";
    const isSanitized = /DOMPurify\s*\.\s*sanitize|TrustedHTML|createHTML|Sanitizer\s*\./.test(source);
    if (!isSanitized) {
      report("svelte-5-doctor/no-at-html-xss", `{@html ${expr}} renders raw HTML without sanitization — XSS risk. Sanitize with DOMPurify.sanitize() or TrustedHTML.`, m.index ?? 0, "Sanitize before {@html}: DOMPurify.sanitize(expr)");
    }
  }
  for (const m of source.matchAll(/\beval\s*\(/g)) report("svelte-5-doctor/no-eval", "eval() is dangerous — avoid dynamic code execution.", m.index ?? 0);
  for (const m of source.matchAll(/\bnew\s+Function\s*\(/g)) report("svelte-5-doctor/no-eval", "new Function() is eval-like — avoid.", m.index ?? 0);
  for (const m of source.matchAll(/\b(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/gi))
    report("svelte-5-doctor/no-secrets-in-client-code", `Possible hardcoded secret: ${m[0].slice(0, 40)}...`, m.index ?? 0);
  for (const m of source.matchAll(/<iframe\b(?![^>]*\bsandbox\b)[^>]*>/gi))
    report("svelte-5-doctor/iframe-missing-sandbox", "<iframe> missing sandbox attribute.", m.index ?? 0);
  if (/<form\b[^>]*>[\s\S]*?\{...[^}]+\}[\s\S]*?<input\b/i.test(source)) {
    const idx = source.search(/\{.../);
    if (idx !== -1) report("svelte-5-doctor/dom-clobbering-risk", "Attribute spreading inside <form> can enable DOM clobbering (CVE-2026-42573). Avoid spreading user-controlled 'name' onto inputs.", idx);
  }

  // ── Correctness: legacy syntax ──
  if (isRunesFile || isSvelte) {
    for (const m of source.matchAll(/\bexport\s+let\s+\w+/g)) {
      if (isRunesFile || source.includes("$props") || source.includes("$state")) {
        // Svelte 5.57.0 (#18692): export let x = $derived(...) gets derived_invalid_export
        const afterExport = source.slice((m.index ?? 0), (m.index ?? 0) + 200);
        const isDerivedExport = /\$derived\s*\(/.test(afterExport.split(";" )[0] ?? "");
        if (isDerivedExport) {
          report("svelte-5-doctor/derived-invalid-export", "`export let x = $derived(...)` is invalid in runes mode — hoist derived to top-level `let x = $derived(...)` (not exported)", m.index ?? 0, `let ${m[0].replace(/export\s+let\s+/, "")} = $derived(...)`);
        } else {
          report("svelte-5-doctor/legacy-export-let", "`export let` is invalid in runes mode — use `let { prop } = $props()`", m.index ?? 0, "let { prop } = $props()");
        }
      }
    }
    for (const m of sourceNoComments.matchAll(/\$\s*:\s*\w+/g)) {
      if (isRunesFile) {
        // Use sourceNoComments to avoid $: inside // or /* comments
        // Map index back to original source for reporting
        const snippet = m[0];
        const idx = source.indexOf(snippet, m.index ?? 0);
        report("svelte-5-doctor/legacy-dollars-colon", "`$:` reactive statement is invalid in runes mode — use $derived / $effect", idx !== -1 ? idx : (m.index ?? 0));
      }
    }
    for (const m of source.matchAll(/on:\w+\s*=/g)) report("svelte-5-doctor/legacy-event-directive", "`on:click` is deprecated in Svelte 5 — use `onclick`", m.index ?? 0, "onclick={handler}");
    for (const m of source.matchAll(/<slot\b/g)) report("svelte-5-doctor/legacy-slot", "<slot> is deprecated — use {#snippet} + {@render}", m.index ?? 0);
    if (/on:\w+/.test(source) && /\bonclick\b/.test(source))
      report("svelte-5-doctor/mixed-event-syntax", "Mixing `on:click` and `onclick` — use Svelte 5 `onclick` only.", source.indexOf("on:"));
    if (/<slot/.test(source) && /\{@render/.test(source))
      report("svelte-5-doctor/slot-snippet-conflict", "Mixing <slot> and {@render} in same file.", source.indexOf("<slot"));
  }

  // ── Correctness: rune placement ──
  for (const m of source.matchAll(/\$state\s*\(/g)) {
    if (filePath.endsWith(".svelte.js") || filePath.endsWith(".svelte.ts")) {
      if (/export\s+let\s+\w+\s*=\s*\$state/.test(source) && /\w+\s*\+=|\w+\s*=/.test(source.slice((m.index ?? 0) + 10, (m.index ?? 0) + 200))) {
        report("svelte-5-doctor/state-invalid-export", "Exporting reassigned $state from .svelte.js leaks across SSR requests — export const instance or getter.", m.index ?? 0);
      }
    }
  }
  for (const m of source.matchAll(/\$props\s*\(/g)) {
    if (!/let\s*\{[^}]*\}\s*=\s*\$props\(\)/.test(source.slice((m.index ?? 0) - 100, (m.index ?? 0) + 50))) {
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
  // rune missing parens: $state without () — handle generics $state<Type>(val) as valid (Svelte 5.56.10) — check for <...>( pattern
  // \b word boundary prevents matching inside identifiers like $effectiveMode
  for (const m of sourceNoComments.matchAll(/\$(state|derived|effect|props|bindable|inspect)\b(?!\s*[\(.<])/g)) {
    const full = m[0];
    if (/\$(state|effect)\.(snapshot|eager|raw|pending|tracking|root)/.test(full)) continue;
    if (full === "$props" || full === "$host") continue;
    const after = sourceNoComments.slice((m.index ?? 0) + full.length, (m.index ?? 0) + full.length + 30);
    const trimmed = after.trim();
    // $state<Type>(value) is valid: after is <...>( — check for <, then > with ( after
    if (trimmed.startsWith("<")) {
      const gtIdx = trimmed.indexOf(">");
      const afterGt = gtIdx !== -1 ? trimmed.slice(gtIdx + 1).trim() : "";
      if (afterGt.startsWith("(")) continue; // generic with parens is valid
    }
    if (!trimmed.startsWith("(") && !trimmed.startsWith(".") && !trimmed.startsWith("<")) {
      report("svelte-5-doctor/rune-requires-parens", `Rune ${full} used without parentheses — add ()`, m.index ?? 0, `${full}()`);
    }
  }
  // non_reactive_update
  const letDecls = [...source.matchAll(/\blet\s+(\w+)\s*=\s*[^;]+/g)];
  for (const decl of letDecls) {
    const varName = decl[1];
    if (!varName) continue;
    const after = source.slice((decl.index ?? 0) + decl[0].length);
    if (new RegExp(`\\b${varName}\\s*\\+=|\\b${varName}\\s*=\\s*[^=]`).test(after) && !source.includes(`$state`) && !source.includes(`$props`)) {
      if (isSvelte && source.includes(`{${varName}}`)) {
        report("svelte-5-doctor/non-reactive-update", `let ${varName} reassigned but not $state — template won't update.`, decl.index ?? 0, `let ${varName} = $state(...)`);
      }
    }
  }
  for (const m of source.matchAll(/setContext\s*\(\s*["'][^"']+["']\s*,\s*(\w+)\s*\)/g)) {
    const arg = m[1];
    if (arg && source.includes(`$state`)) report("svelte-5-doctor/state-referenced-locally", `setContext('key', ${arg}) snapshots value — use () => ${arg} getter or createContext.`, m.index ?? 0);
  }
  for (const m of source.matchAll(/\{#snippet\s+\w+\s*\([^)]*\.\.\./g))
    report("svelte-5-doctor/snippet-invalid-rest", "Snippet with rest params is invalid.", m.index ?? 0);

  // ── Correctness: effects & derived ──
  for (const m of source.matchAll(/\$effect\s*\(\s*\(\)\s*=>\s*\{[^}]*\b\w+\s*=\s*[^}]*\}/g)) {
    const body = m[0];
    if (/\w+\s*=\s*\w+\s*\*\s*\w+|\w+\s*=\s*\w+\s*\+\s*\w+/.test(body) && !/fetch|setTimeout|addEventListener/.test(body)) {
      report("svelte-5-doctor/no-effect-derived", "Deriving state inside $effect — use $derived instead.", m.index ?? 0, "let x = $derived(y * 2)");
    }
  }
  // effect-no-derived-computation: broader — any $effect that only assigns to $state
  for (const m of source.matchAll(/\$effect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\)/g)) {
    const body = (m[1] ?? "").trim();
    // body is single assignment to state var, no external side effect like fetch, console, DOM, setTimeout
    const linesBody = body.split(";").map((s) => s.trim()).filter(Boolean);
    if (linesBody.length === 1 && /^\w+\s*=/.test(linesBody[0] ?? "") && !/fetch|console\.|addEventListener|setTimeout|setInterval|document\.|window\./.test(body)) {
      const lhs = linesBody[0]!.split("=")[0]!.trim();
      if (stateVars.has(lhs)) {
        report("svelte-5-doctor/effect-no-derived-computation", `$effect only assigns to $state '${lhs}' without side effect — use $derived instead.`, m.index ?? 0, `let ${lhs} = $derived(...)`);
      }
    }
  }
  // effect cleanup
  for (const m of source.matchAll(/\$effect\s*\(\s*\(\)\s*=>\s*\{[^}]*\b(setInterval|setTimeout|addEventListener)\s*\(/g)) {
    const snippet = source.slice(m.index ?? 0, (m.index ?? 0) + 500);
    if (!/return\s*\(\)\s*=>/.test(snippet) && !/return\s*function/.test(snippet)) {
      report("svelte-5-doctor/effect-needs-cleanup", `${m[1]} inside $effect without cleanup — return () => clear...`, m.index ?? 0);
    }
  }
  // effect-placement: let x = $effect
  for (const m of source.matchAll(/\b(?:let|const|var)\s+\w+\s*=\s*\$effect(?:\.pre)?\s*\(/g)) {
    report("svelte-5-doctor/effect-placement", "$effect used as value — must be expression statement $effect(()=>{...})", m.index ?? 0);
  }
  // effect async tracking loss: await inside effect/derived then read state
  for (const m of source.matchAll(/\$(effect|derived)(?:\.by)?\s*\(\s*(?:\(\)\s*=>)?\s*\{?[^}]*await[^}]*\}/gs)) {
    const block = m[0];
    const hasAwait = /await/.test(block);
    if (hasAwait) {
      // check if state var is read after await
      const afterAwait = block.split("await").slice(1).join("await");
      for (const sv of stateVars) {
        if (new RegExp(`\\b${sv}\\b`).test(afterAwait)) {
          report("svelte-5-doctor/effect-async-tracking-loss", `State '${sv}' read after await inside $${m[1]} is not tracked — add void ${sv} before await or wrap with untrack.`, m.index ?? 0);
          break;
        }
      }
      for (const pv of propsVars) {
        if (new RegExp(`\\b${pv}\\b`).test(afterAwait)) {
          report("svelte-5-doctor/effect-async-tracking-loss", `Prop '${pv}' read after await is not tracked — add void ${pv} before await.`, m.index ?? 0);
          break;
        }
      }
    }
  }
  // effect-require-untrack-for-self-write: reads and writes same signal without untrack — precise RHS check
  for (const m of source.matchAll(/\$effect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\)/g)) {
    const body = m[1] ?? "";
    if (/untrack/.test(body)) continue;
    for (const sv of stateVars) {
      let isSelfWrite = false;
      for (const am of body.matchAll(new RegExp(`\\b${sv}\\s*=\\s*([^;\\n}]+)`, "g"))) {
        const rhs = am[1] ?? "";
        if (new RegExp(`\\b${sv}\\b`).test(rhs)) { isSelfWrite = true; break; }
      }
      if (!isSelfWrite && new RegExp(`\\b${sv}\\s*(\\+\\+|--|\\+=|-=)`).test(body)) {
        // check if also reads elsewhere (e.g., count = count + 1 already handled, but count++ alone is self)
        if (new RegExp(`\\b${sv}\\b`).test(body.replace(new RegExp(`\\b${sv}\\s*(\\+\\+|--|\\+=|-=|=)[^;]*`, "g"), ""))) isSelfWrite = true;
        else if (/\+\+|--/.test(body)) isSelfWrite = true;
      }
      if (isSelfWrite) {
        report("svelte-5-doctor/effect-require-untrack-for-self-write", `Effect reads and writes '${sv}' without untrack — wrap read with untrack(()=>${sv}) or use $derived`, m.index ?? 0);
        break;
      }
    }
  }
  for (const m of source.matchAll(/\$derived\s*\([^)]*\)\s*\{[^}]*\w+\s*\+=|\$derived\([^)]*=>[^)]*\{[^}]*\w+\+\+/g))
    report("svelte-5-doctor/no-mutate-in-derived", "Mutating state inside $derived is forbidden.", m.index ?? 0);
  for (const m of source.matchAll(/\$derived\s*\(\s*\w+\s*\)/g))
    report("svelte-5-doctor/no-derived-simple", "Useless $derived wrapping single variable — use directly.", m.index ?? 0);
  // derived-writable version gate: d +=1 where d is derived
  for (const m of source.matchAll(/(\w+)\s*(\+=|-=|\+\+|--)/g)) {
    const v = m[1]!;
    if (derivedVars.has(v)) {
      report("svelte-5-doctor/derived-writable-version-gate", `Derived '${v}' reassigned — needs svelte@5.25+ (check package.json svelte version)`, m.index ?? 0);
    }
  }
  // experimental-async: await in $derived/template needs svelte.config.js experimental.async:true (Svelte 5.36+)
  if (/\bawait\b/.test(source) && (/\$derived.*await/.test(source) || /\{@await/.test(source) || /\{#await/.test(source))) {
    let hasFlag = false;
    if (directory) {
      for (const cfg of ["svelte.config.js", "svelte.config.ts"]) {
        try {
          const cfgPath = join(directory, cfg);
          if (existsSync(cfgPath)) {
            const cfgSrc = readFileSync(cfgPath, "utf-8");
            if (/experimental\s*:\s*\{\s*async\s*:\s*true/.test(cfgSrc)) { hasFlag = true; break; }
          }
        } catch {}
      }
    }
    if (!hasFlag) hasFlag = /experimental\s*:\s*\{\s*async\s*:\s*true/.test(source);
    if (!hasFlag && isSvelte) {
      const idx = source.indexOf("await");
      report("svelte-5-doctor/experimental-async", "await in $derived/template needs svelte.config.js compilerOptions.experimental.async:true", idx);
    }
  }

  // ── 0.5.0 P0: rune-outside-svelte, proxy-equality, await-waterfall (SvelteKit 2/3 aware) ──
  // rune-outside-svelte: rune in .js/.ts not in .svelte family — version-aware: only report if not in .svelte.* and not in node_modules/.svelte-kit
  if (!isSvelte && !filePath.endsWith(".svelte.js") && !filePath.endsWith(".svelte.ts") && !filePath.includes("node_modules") && !filePath.includes(".svelte-kit")) {
    const runeMatch = source.match(/\$(state|derived|effect|props|bindable|inspect)\s*\(/);
    if (runeMatch) {
      const idx = source.indexOf(runeMatch[0]);
      // SvelteKit 2 vs 3: both use same rune files, so no version gate needed for this rule — just file extension
      report("svelte-5-doctor/rune-outside-svelte", `Rune ${runeMatch[0].trim()} outside .svelte/.svelte.js/.svelte.ts — rename file to .svelte.js/.svelte.ts or move to .svelte`, idx);
    }
  }
  // state-proxy-equality-mismatch: proxy === raw always false — only for object/array $state, not primitives (string/number/boolean/null)
  for (const sv of stateVars) {
    // Check initialization: only flag if $state arg is object/array ( {, [, new Set(, new Map(, etc.), not primitive 'all', 0, true, null
    const initMatch = source.match(new RegExp(`\\b(?:let|const)\\s+${sv}\\s*=\\s*\\$state(?:\\.raw)?\\s*\\(\\s*([^)]*)\\s*\\)`));
    const initArg = initMatch?.[1]?.trim() ?? "";
    const isPrimitiveInit = /^['"`].*['"`]$/.test(initArg) || /^(true|false|null|undefined|\d+(\.\d+)?)$/.test(initArg) || initArg === "" || initArg === "''" || initArg === '""';
    const isObjectInit = /^[\{\[]/.test(initArg) || /new\s+(Set|Map|Date|Object|Array)/.test(initArg) || initArg.includes("{") || initArg.includes("[");
    // Only flag if initialized with object/array (proxied), not primitive
    if (isPrimitiveInit && !isObjectInit) continue;
    const reEq = new RegExp(`\\b${sv}\\s*===?\\s*\\w+|\\w+\\s*===?\\s*\\b${sv}\\b`, "g");
    for (const m of source.matchAll(reEq)) {
      const snippet = m[0];
      const isSnapshot = snippet.includes("$state.snapshot");
      if (!isSnapshot) {
        report("svelte-5-doctor/state-proxy-equality-mismatch", `Comparing proxy '${sv}' with raw object via === always false — use $state.snapshot(${sv})`, m.index ?? 0);
        break;
      }
    }
  }
  // await-waterfall: sequential await where Promise.all would halve latency — Svelte 5.55+ runtime warning
  // Only flag if two awaits are independent (not dependent) and in same $derived/$effect or top-level
  const awaitBlocks = [...source.matchAll(/await\s+\w+/g)];
  if (awaitBlocks.length >= 2) {
    let hasWaterfall = false;
    for (let i = 0; i < awaitBlocks.length - 1; i++) {
      const a1 = awaitBlocks[i]!;
      const a2 = awaitBlocks[i + 1]!;
      const between = source.slice((a1.index ?? 0) + a1[0].length, a2.index ?? 0);
      // If between contains no data dependency (no variable from first await used in second), and both in same function/derived
      if (!between.includes("=") && between.length < 200) {
        // Check if both awaits are in same $derived or top-level, not dependent
        const beforeFirst = source.slice(Math.max(0, (a1.index ?? 0) - 500), a1.index ?? 0);
        if (/\$derived|\$effect/.test(beforeFirst) || !/await.*await/.test(between)) {
          hasWaterfall = true;
          break;
        }
      }
    }
    if (hasWaterfall) report("svelte-5-doctor/await-waterfall", "Sequential await where Promise.all would halve latency — Svelte 5.55+ await_waterfall", (awaitBlocks[1]?.index ?? 0));
  }

  // ── Props/Bindable/Raw/Snapshot ──
  // state-destructure-loss: let {a}= stateVar
  for (const m of source.matchAll(/\b(?:let|const)\s*\{\s*([^}]+)\}\s*=\s*(\w+)\s*[;\n]/g)) {
    const rhs = m[2]!;
    if (stateVars.has(rhs) || propsVars.includes(rhs)) {
      const destr = m[1] ?? "";
      report("svelte-5-doctor/state-destructure-loss", `Destructuring '${destr.trim()}' from '${rhs}' loses reactivity — use $derived or access via ${rhs}.prop`, m.index ?? 0);
    }
  }
  // props-derived-required: let color = type === ... where type is prop
  for (const m of source.matchAll(/\b(?:let|const)\s+(\w+)\s*=\s*([^;\n]+)/g)) {
    const lhs = m[1]!;
    const rhs = m[2] ?? "";
    if (derivedVars.has(lhs) || stateVars.has(lhs)) continue;
    if (rhs.includes("$derived") || rhs.includes("$state") || rhs.includes("$effect")) continue;
    for (const pv of propsVars) {
      if (new RegExp(`\\b${pv}\\b`).test(rhs)) {
        // plain assign from prop, not derived
        report("svelte-5-doctor/props-derived-required", `Prop '${pv}' used to derive '${lhs}' without $derived — will not update when prop changes.`, m.index ?? 0, `let ${lhs} = $derived(${rhs.trim()})`);
        break;
      }
    }
  }
  // props-fallback-no-mutate: fallback var mutated
  for (const fb of propsFallbackVars) {
    const re = new RegExp(`\\b${fb}\\s*\\.\\w+\\s*=|\\b${fb}\\s*\\+=|\\b${fb}\\.push\\s*\\(`);
    const idx = source.search(re);
    if (idx !== -1) report("svelte-5-doctor/props-fallback-no-mutate", `Fallback prop '${fb}' mutated — fallback is not proxied, reassign or make $bindable`, idx);
  }
  // bindable-mutation-without-bindable: prop mutated without $bindable — ignore default value in let {a = default} = $props()
  for (const pv of propsVars) {
    if (bindableVars.has(pv)) continue;
    // Find props block to exclude default values inside let { ... } = $props()
    const propsBlockMatch = source.match(/let\s*\{[^}]+\}\s*=\s*\$props\(\)/);
    const propsBlockStart = propsBlockMatch?.index ?? -1;
    const propsBlockEnd = propsBlockStart !== -1 ? propsBlockStart + (propsBlockMatch?.[0]?.length ?? 0) : -1;
    const re = new RegExp(`\\b${pv}\\s*\\.\\w+\\s*(=|\\+=|\\+\\+)|\\b${pv}\\s*=\\s*[^=]`);
    const m = re.exec(source);
    if (m) {
      const idx = m.index ?? source.indexOf(pv);
      // Skip if inside props destructuring default value
      if (propsBlockStart !== -1 && idx >= propsBlockStart && idx < propsBlockEnd) continue;
      if (source.slice(idx, idx + 50).includes("=") || source.slice(idx, idx + 50).includes("++")) {
        if (new RegExp(`\\b${pv}\\b.*=.*`).test(source)) {
          const afterProps = source.indexOf("$props()");
          const mutIdx = source.indexOf(pv, afterProps + 10);
          if (mutIdx !== -1 && mutIdx !== idx && source.slice(mutIdx, mutIdx + 100).match(/\.|\+|=/)) {
            report("svelte-5-doctor/bindable-mutation-without-bindable", `Prop '${pv}' mutated without $bindable — mark let {${pv}=$bindable()} or use callback prop`, mutIdx);
            break;
          }
          // Also check for mutation after props block, not just first occurrence
          const allMuts = [...source.matchAll(new RegExp(`\\b${pv}\\s*(?:\\.\\w+\\s*=|\\s*=\\s*[^=])`, "g"))].filter((mm) => (mm.index ?? 0) > propsBlockEnd);
          if (allMuts.length > 0) {
            report("svelte-5-doctor/bindable-mutation-without-bindable", `Prop '${pv}' mutated without $bindable — mark let {${pv}=$bindable()} or use callback prop`, allMuts[0]!.index ?? idx);
            break;
          }
        }
      }
    }
  }
  // raw-mutation-noop
  for (const rv of rawStateVars) {
    const patterns = [`\\b${rv}\\s*\\.push\\s*\\(`, `\\b${rv}\\s*\\.pop\\s*\\(`, `\\b${rv}\\s*\\.splice\\s*\\(`, `\\b${rv}\\s*\\.shift\\s*\\(`, `\\b${rv}\\s*\\[.*\\]\\s*=`, `\\b${rv}\\s*\\.\\w+\\s*=`];
    for (const pat of patterns) {
      const re = new RegExp(pat);
      const m = re.exec(source);
      if (m) {
        report("svelte-5-doctor/raw-mutation-noop", `Raw state '${rv}' mutated with ${m[0].trim()} — no effect (raw needs reassignment: ${rv}=[...${rv}])`, m.index ?? 0);
        break;
      }
    }
  }
  // snapshot-required: proxy passed to external lib without snapshot
  for (const sv of stateVars) {
    const extCalls = [`structuredClone\\s*\\(\\s*${sv}\\b`, `JSON\\.stringify\\s*\\(\\s*${sv}\\b`, `postMessage\\s*\\(\\s*${sv}\\b`, `IndexedDB|\\.put\\s*\\(\\s*${sv}\\b`, `\\.send\\s*\\(\\s*${sv}\\b`];
    for (const pat of extCalls) {
      const re = new RegExp(pat);
      const m = re.exec(source);
      if (m && !source.includes(`$state.snapshot(${sv})`)) {
        report("svelte-5-doctor/snapshot-required", `Passing reactive proxy '${sv}' to external API — use $state.snapshot(${sv})`, m.index ?? 0, `$state.snapshot(${sv})`);
        break;
      }
    }
  }
  // class-state-private-enumerability: class with $state and Object.keys/spread without toJSON
  if (/class\s+\w+\s*\{[^}]*\$state/.test(source)) {
    if (/Object\.keys|JSON\.stringify|\{\s*\.\.\.\s*\w+/.test(source) && !/toJSON\s*\(/.test(source)) {
      const idx = source.search(/class\s+\w+/);
      report("svelte-5-doctor/class-state-private-enumerability", "Class with $state fields used with Object.keys/JSON/spread but no toJSON — private fields hidden", idx);
    }
  }
  // P1: assignment-value-stale: (arr ??= []).push(arr.length) discards push
  for (const m of source.matchAll(/\(\s*\w+\s*\?\?=.*?\)\s*\.push\s*\(/g)) {
    report("svelte-5-doctor/assignment-value-stale", "Assignment value stale: (arr ??= []).push() discards push — split to arr ??= []; arr.push(...)", m.index ?? 0);
  }
  // P1: console-log-state: console.log(proxy) logs Proxy not value
  for (const m of source.matchAll(/console\.\w+\s*\(\s*(\w+)\s*\)/g)) {
    const arg = m[1]!;
    if (stateVars.has(arg) && !source.slice((m.index ?? 0) - 100, (m.index ?? 0)).includes("$state.snapshot") && !source.slice((m.index ?? 0), (m.index ?? 0) + 100).includes("$state.snapshot")) {
      report("svelte-5-doctor/console-log-state", `console.log of $state proxy '${arg}' logs Proxy{} — use $state.snapshot(${arg}) or $inspect(${arg})`, m.index ?? 0, `$state.snapshot(${arg})`);
    }
  }
  // P1: derived-inert: $derived inside $effect
  for (const m of source.matchAll(/\$effect\s*\(\s*\(\)\s*=>\s*\{[^}]*\$derived\s*\(/g)) {
    report("svelte-5-doctor/derived-inert", "$derived inside $effect becomes inert after teardown — hoist derived outside effect", m.index ?? 0);
  }
  // P1: each-key-volatile: each key is new array/object literal
  for (const m of source.matchAll(/\{#each\s+[^}]+\s+\(\s*\[.*\]\s*\)/g)) {
    report("svelte-5-doctor/each-key-volatile", "Each key is new array literal each tick — volatile, thrashes DOM. Use stable string/number", m.index ?? 0);
  }
  for (const m of source.matchAll(/\{#each\s+[^}]+\s+\(\s*\{.*\}\s*\)/g)) {
    report("svelte-5-doctor/each-key-volatile", "Each key is new object literal each tick — volatile", m.index ?? 0);
  }
  // P2: module-shared-state-ssr-leak: top-level $state in src/lib/*.svelte.ts (not $lib/server) — SvelteKit 2/3 agnostic, check $lib/server allowlist
  if ((filePath.includes("src/lib/") || filePath.startsWith("lib/")) && (filePath.endsWith(".svelte.ts") || filePath.endsWith(".svelte.js")) && !filePath.includes("$lib/server") && !filePath.includes("lib/server") && /\bexport\s+(const|let)\s+\w+\s*=\s*\$state/.test(source) && !/createContext/.test(source)) {
    const idx = source.search(/\bexport\s+(const|let)\s+\w+\s*=\s*\$state/);
    report("svelte-5-doctor/module-shared-state-ssr-leak", "Top-level $state in src/lib/*.svelte.ts leaks across SSR requests — use createContext or $lib/server", idx);
  }
  // P2: store-subscription-outside-svelte: $store in .svelte.ts/.svelte.js
  if ((filePath.endsWith(".svelte.ts") || filePath.endsWith(".svelte.js") || filePath.endsWith(".ts") || filePath.endsWith(".js")) && !filePath.endsWith(".svelte") && /\$[a-zA-Z_]\w*\b/.test(source) && /from\s+['"]svelte\/store['"]/.test(source)) {
    for (const m of source.matchAll(/\$([a-zA-Z_]\w*)\b/g)) {
      const name = m[1]!;
      if (["state","derived","effect","props","bindable","inspect","host"].includes(name)) continue;
      // Check if it's a store subscription (has writable store import)
      if (new RegExp(`\\b${name}\\b`).test(source)) {
        report("svelte-5-doctor/store-subscription-outside-svelte", `$store subscription '$${name}' only works inside .svelte — use get(${name}) in .svelte.ts`, m.index ?? 0);
        break;
      }
    }
  }
  // P2: hydration-risk: invalid HTML that browser repairs
  if (/<p>\s*<div|\<table\>\s*<tr>|\<tr\>\s*<td>.*<\/tr>\s*<\/table>|<option>.*<div/.test(source)) {
    const idx = source.search(/<p>\s*<div|<table>\s*<tr>|<option>.*<div/);
    report("svelte-5-doctor/hydration-risk", "Invalid HTML that browser repairs causes hydration_mismatch — fix nesting", idx !== -1 ? idx : 0);
  }
  // P2: remote-await-boundary: await query() outside <svelte:boundary> — SvelteKit 2.68+/3 with remoteFunctions
  // Version-aware: only report if file is in SvelteKit and uses query/remote, and no boundary
  if (/await\s+\w*query|\.remote\.ts|from\s+['"].*\/remote['"]/.test(source) && /await/.test(source) && !/<svelte:boundary/.test(source)) {
    // Check if project is SvelteKit with remoteFunctions (via directory svelte.config.js)
    let isRemoteEnabled = false;
    if (directory) {
      try {
        for (const cfg of ["svelte.config.js", "svelte.config.ts"]) {
          const cfgPath = join(directory, cfg);
          if (existsSync(cfgPath)) {
            const cfgSrc = readFileSync(cfgPath, "utf-8");
            if (/remoteFunctions\s*:\s*true/.test(cfgSrc) || /experimental\s*:\s*\{\s*async/.test(cfgSrc)) { isRemoteEnabled = true; break; }
          }
        }
      } catch {}
    }
    // For SvelteKit 3, remoteFunctions is stable, so always check if file uses query
    if (isRemoteEnabled || /query/.test(source)) {
      const idx = source.search(/await\s+\w*query|await\s+.*\.remote/);
      if (idx !== -1) report("svelte-5-doctor/remote-await-boundary", "await query() outside <svelte:boundary pending> renders pending on server (remoteFunctions) — wrap in <svelte:boundary>", idx);
    }
  }
  // P2: props-id-placement: $props.id() only top-level
  for (const m of source.matchAll(/\$props\.id\(\)/g)) {
    const before = source.slice(0, m.index ?? 0);
    const lastLet = before.lastIndexOf("let ");
    const lastConst = before.lastIndexOf("const ");
    const lastTopLevel = Math.max(before.lastIndexOf("\nlet "), before.lastIndexOf("\nconst "), 0);
    // Check if inside if/effect/function
    const snippetBefore = before.slice(-300);
    if (/\bif\s*\(|\$effect|function\s+\w*\s*\(/.test(snippetBefore)) {
      report("svelte-5-doctor/props-id-placement", "$props.id() only at top-level variable initializer — inside if/effect causes hydration mismatch", m.index ?? 0);
    }
  }
  // props-invalid: additional checks for nested/computed props
  for (const m of source.matchAll(/let\s*\{\s*[^}]*\.\s*\w+[^}]*\}\s*=\s*\$props\(\)/g)) {
    report("svelte-5-doctor/props-invalid", "$props() destructuring uses nested/computed property — invalid pattern", m.index ?? 0);
  }
  // store-rune-conflict: $count vs $state conflict
  for (const m of source.matchAll(/\$(\w+)\b/g)) {
    const name = m[1]!;
    if (["state","derived","effect","props","bindable","inspect","host"].includes(name)) continue;
    if (stateVars.has(name) && source.includes(`$${name}`)) {
      // check if store subscription syntax $name is used while local var exists
      if (new RegExp(`\\$${name}\\b`).test(source) && /\bimport\s*\{[^}]*writable|readable|derived[^}]*\}\s*from\s*['"]svelte\/store['"]/.test(source)) {
        report("svelte-5-doctor/store-rune-conflict", `Local '${name}' shadows store subscription '$${name}' — rename`, m.index ?? 0);
      }
    }
  }
  // attribute-sequence: comma in attribute
  for (const m of source.matchAll(/\b\w+\s*=\s*\{[^}]*,\s*[^}]+\}/g)) {
    const inside = m[0].slice(m[0].indexOf("{") + 1, m[0].lastIndexOf("}"));
    if (inside.includes(",") && !inside.includes("[") && !inside.includes("?")) {
      // check if inside is sequence expression like {a, b}
      if (/^\s*\w+\s*,\s*\w+/.test(inside)) {
        report("svelte-5-doctor/attribute-sequence", `Comma sequence in attribute — use {[a,b]} or expression`, m.index ?? 0);
      }
    }
  }

  // ── Performance ──
  for (const m of source.matchAll(/\{#each\s+[^\}]+ as [^\}]+}/g)) {
    const block = m[0];
    if (!/\(.+\)/.test(block)) report("svelte-5-doctor/no-index-as-key", "{#each} without key — use `{#each items as item (item.id)}`", m.index ?? 0);
    else if (/\(\s*\w+\s*\)/.test(block) && /,\s*i\s*\)/.test(block)) report("svelte-5-doctor/no-index-as-key", "{#each} using index as key is unstable.", m.index ?? 0);
  }
  for (const m of source.matchAll(/\{#each\s+(\w+)\s+as\s+(\w+)[^}]*\}[\s\S]*?bind:value=\{(\w+)\}/g)) {
    const item = m[2];
    if (item === m[3]) report("svelte-5-doctor/each-item-mutation", `bind:value={${item}} mutates each item directly — use array[index].`, m.index ?? 0);
  }
  // each-item-assignment: each_item_invalid_assignment
  for (const m of source.matchAll(/\{#each\s+\w+\s+as\s+(\w+)/g)) {
    const item = m[1]!;
    const re = new RegExp(`\\b${item}\\s*=\\s*[^=]`);
    const after = source.slice(m.index ?? 0, (m.index ?? 0) + 500);
    if (re.test(after) && !after.includes(`${item}[`)) {
      const idx = source.indexOf(`${item} =`, m.index ?? 0);
      if (idx !== -1) report("svelte-5-doctor/each-item-assignment", `Mutating each item '${item}' directly — use array[index]`, idx);
    }
  }
  for (const m of source.matchAll(/\$state\s*\(\s*\{[^}]{200,}\}/g))
    report("svelte-5-doctor/perf-avoid-deep-proxy", "Large object with $state proxies deeply — consider $state.raw + reassignment.", m.index ?? 0);
  for (const m of source.matchAll(/\$effect\s*\([^)]*\)\s*=>\s*\{[^}]*new\s+class\b/g))
    report("svelte-5-doctor/perf-avoid-inline-class", "new class inside $effect — hoist to module scope.", m.index ?? 0);
  // perf-avoid-inline-class: class inside component top-level
  for (const m of source.matchAll(/\bclass\s+\w+\s*(?:extends\s+\w+)?\s*\{/g)) {
    const before = source.slice(0, m.index ?? 0);
    const lastScript = before.lastIndexOf("<script");
    const inComponent = lastScript !== -1 && before.slice(lastScript).includes("$state") || before.slice(lastScript).includes("$derived");
    if (inComponent && !source.slice(0, m.index ?? 0).includes("export class") && before.split("\n").length > 10) {
      // check if class is inside function/component not top-level module
      if (/function\s+\w+\s*\(|=>\s*\{[^}]*class/.test(before.slice(-500))) {
        report("svelte-5-doctor/perf-avoid-inline-class", "Class declared inside component/effect — hoist to module scope for perf", m.index ?? 0);
      }
    }
  }
  // no-layout-animation: only flag layout props (width/height/top/left etc.) when actually animated, not compositing (opacity/transform)
  for (const m of source.matchAll(/transition:\w+[^}]*width|animate:[^;]*width|style:[^;]*width/g)) {
    // Skip @keyframes that only use opacity/transform (compositing) — check if block contains only opacity/transform
    const block = m[0];
    const isCompositingOnly = /opacity|transform/.test(block) && !/width|height|top|left|right|bottom|margin|padding/.test(block.replace(/opacity|transform/g, ""));
    if (!isCompositingOnly && /width|height|top|left/.test(block)) report("svelte-5-doctor/no-layout-animation", "Animating layout properties causes thrash — use transform/opacity.", m.index ?? 0);
  }
  // Also handle @keyframes with layout props: only flag if keyframes block contains width/height/top/left etc. and not just opacity/transform
  for (const m of source.matchAll(/@keyframes\s+\w+\s*\{[^}]*\b(width|height|top|left|right|bottom|margin|padding)\b[^}]*\}/gs)) {
    const block = m[0];
    if (!/opacity|transform/.test(block) || /width|height/.test(block)) {
      // Only flag if actually animating layout, not compositing
      report("svelte-5-doctor/no-layout-animation", "Animating layout properties in @keyframes causes thrash — use transform/opacity.", m.index ?? 0);
    }
  }
  for (const m of source.matchAll(/transition:\s*all\b/g)) report("svelte-5-doctor/no-transition-all", "transition:all is expensive — specify property.", m.index ?? 0);
  for (const m of source.matchAll(/filter:\s*blur\(\s*(\d+)px\)/g)) {
    const r = Number.parseInt(m[1] ?? "0", 10);
    if (r > 20) report("svelte-5-doctor/no-large-animated-blur", `Large blur(${r}px) animation is expensive — reduce radius.`, m.index ?? 0);
  }
  for (const m of source.matchAll(/\.filter\s*\([^)]+\)\s*\.map\s*\(/g)) report("svelte-5-doctor/js-combine-iterations", "filter().map() does 2 passes — use single loop or flatMap.", m.index ?? 0);
  for (const m of source.matchAll(/for\s*\([^)]+\)\s*\{[^}]*new\s+RegExp\s*\(/g)) report("svelte-5-doctor/js-hoist-regexp", "RegExp inside loop — hoist.", m.index ?? 0);
  for (const m of source.matchAll(/for\s*\([^)]+\)\s*\{[^}]*new\s+Intl\./g)) report("svelte-5-doctor/js-hoist-intl", "Intl.* inside loop — hoist.", m.index ?? 0);
  for (const m of source.matchAll(/from\s+["'][^"']*\/index["']|import\s+\*\s+as\s+\w+\s+from\s+["']lodash["']/g))
    report("svelte-5-doctor/no-barrel-import", "Barrel/lodash full import hurts tree-shaking — import specific path.", m.index ?? 0);

  // ── Kit & SvelteKit ──
  if (/\+page\.server\.ts|\+layout\.server\.ts|\+server\.ts|hooks\.server/.test(filePath)) {
    if (/\b(let|const)\s+\w+\s*=\s*\$state/.test(source) || /class\s+\w+[^}]*\$state/.test(source)) {
      report("svelte-5-doctor/kit-prefer-context-over-module-state", "Module-level $state in server file leaks across requests — use createContext or event.locals", source.search(/\$state/));
    }
  }
  for (const m of source.matchAll(/from\s+['"]\$env\/static\/private['"]/g)) {
    if (!/\.server\.(ts|js)|\$lib\/server/.test(filePath) && !filePath.includes(".server.")) {
      report("svelte-5-doctor/kit-remote-boundary-required", "Private env import in client — move to $lib/server/** or .server.ts", m.index ?? 0);
    }
  }
  if (/query\s*\(|remote.*query/.test(source) && /await\s+.*query/.test(source)) {
    if (!/<svelte:boundary/.test(source) && !/\$effect\.pending/.test(source)) {
      const idx = source.search(/await.*query/);
      if (idx !== -1) report("svelte-5-doctor/kit-remote-boundary-required", "await query() without <svelte:boundary> pending snippet — SSR crash risk", idx);
    }
  }
  for (const m of source.matchAll(/\.run\s*\(\)/g)) {
    if (/query|remote/.test(source.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0))) {
      report("svelte-5-doctor/kit-remote-run-removed", ".run() on remote query removed in 2.61 — use await query()", m.index ?? 0);
    }
  }
  for (const m of source.matchAll(/\brequested\s*\(/g)) {
    const after = source.slice(m.index ?? 0, (m.index ?? 0) + 200);
    if (!/limit\s*:/.test(after)) {
      report("svelte-5-doctor/kit-requested-limit", "requested() without limit — breaking in 2.58, add {limit} and handle {arg, query}", m.index ?? 0);
    }
  }
  // $app/state is designed for top-level import — only flag top-level READS outside reactive context, not the import itself
  if (/from\s+['"]\$app\/state['"]/.test(source)) {
    // Find all page.url/params/data reads
    for (const m of source.matchAll(/page\.(url|params|data)\b/g)) {
      const before = source.slice(0, m.index ?? 0);
      const lineStart = before.lastIndexOf("\n") + 1;
      const line = source.slice(lineStart, (m.index ?? 0) + 20).trim();
      // Skip if read is inside $derived, $effect, function, or onMount
      const context = before.slice(-800);
      const inReactive = /\$derived|\$effect|onMount|function\s+\w*\s*\(/.test(context.slice(-300));
      const inImport = line.includes("import") && line.includes("$app/state");
      if (!inReactive && !inImport && !line.startsWith("import")) {
        // Check if at top-level (not inside function)
        const indent = (source.slice(lineStart, m.index ?? 0).match(/^\s*/) ?? [""])[0].length;
        if (indent === 0) {
          report("svelte-5-doctor/kit-app-state-eager-init", "$app/state read at module top-level — move inside $derived/$effect/onMount to avoid eager leak (2.70.3)", m.index ?? 0);
          break;
        }
      }
    }
  }

  // ── Maintainability ──
  if (filePath.endsWith(".svelte") && lines.length > GIANT_COMPONENT_THRESHOLD_LINES)
    report("svelte-5-doctor/no-giant-component", `Component is ${lines.length} lines (threshold ${GIANT_COMPONENT_THRESHOLD_LINES}) — split via snippets/composition.`, 0);
  for (const m of source.matchAll(/\{#if[\s\S]*?\{#snippet|\{#each[\s\S]*?\{#snippet/g))
    report("svelte-5-doctor/no-nested-snippet", "Snippet defined inside markup recreates each render — hoist to top-level.", m.index ?? 0);

  // ── a11y ──
  for (const m of source.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) report("svelte-5-doctor/a11y-missing-attribute", "<img> missing alt attribute.", m.index ?? 0);
  for (const m of source.matchAll(/<a\b(?![^>]*\bhref=)(?![^>]*\{href\})[^>]*>/gi)) {
    // Skip if inside {#if href} or {#if condition} where href is guaranteed (Svelte conditional rendering)
    const before = source.slice(Math.max(0, (m.index ?? 0) - 800), m.index ?? 0);
    const lastIf = before.lastIndexOf("{#if");
    const lastEndIf = before.lastIndexOf("{/if}");
    const insideIf = lastIf > lastEndIf;
    if (insideIf) {
      const ifCondition = before.slice(lastIf, lastIf + 200);
      if (/\bhref\b/.test(ifCondition)) continue;
    }
    report("svelte-5-doctor/a11y-missing-attribute", "<a> missing href.", m.index ?? 0);
  }
  for (const m of source.matchAll(/onclick\s*=\s*\{[^}]+\}(?![^<]*onkeydown)/gi)) {
    const tagMatch = source.slice(Math.max(0, (m.index ?? 0) - 100), m.index ?? 0).match(/<(\w+)\b[^>]*$/);
    const tag = tagMatch?.[1] ?? "";
    if (tag === "div" || tag === "span") report("svelte-5-doctor/a11y-click-events-have-key-events", `<${tag}> with onclick missing keyboard handler.`, m.index ?? 0);
  }

  // ── Svelte 5.57.0+: undeclared shorthand event handlers on special elements (#18480) ──
  // Svelte 5.57.0 warns on <svelte:window onclick={handler}> when handler is not declared in script.
  // Detect shorthand (no =) event attributes on svelte:window/document/body.
  for (const m of source.matchAll(/<svelte:(window|document|body)\b([^>]*)>/gi)) {
    const tag = m[1] ?? "";
    const attrs = m[2] ?? "";
    const eventShorthands = [...attrs.matchAll(/\bon(\w+)\b(?!=)/g)];
    for (const ev of eventShorthands) {
      const handler = ev[0] ?? "";
      // Check if the handler is declared in the script
      const handlerName = handler.replace(/^on/, "");
      const handlerRegex = new RegExp(`\\b${handlerName}\\b`);
      if (!handlerRegex.test(source.slice(0, m.index ?? 0))) {
        report("svelte-5-doctor/special-element-undeclared-handler", `<svelte:${tag}> has shorthand event handler ${handler} but it is not declared in <script> — Svelte 5.57.0+ will warn`, m.index ?? 0);
      }
    }
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
  let files = await collectFiles(directory);

  // Load svelte-5-doctor.config.json/.ts if present (like svelte-5-doctor.config.ts in Genesis)
  let configRules: Record<string, string> = {};
  let configIgnore: string[] = [];
  for (const cfgName of ["svelte-5-doctor.config.json", "svelte-5-doctor.config.ts", "svelte-5-doctor.config.js", "svelte-doctor.config.json"]) {
    const cfgPath = join(directory, cfgName);
    if (existsSync(cfgPath)) {
      try {
        const raw = readFileSync(cfgPath, "utf-8");
        if (cfgName.endsWith(".json")) {
          const j = JSON.parse(raw);
          configRules = j.rules ?? {};
          configIgnore = j.ignore ?? [];
        } else {
          const rulesMatch = raw.match(/rules\s*:\s*\{([\s\S]*?)\}/);
          if (rulesMatch) {
            const inner = rulesMatch[1] ?? "";
            for (const m of inner.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) {
              configRules[m[1]!] = m[2]!;
            }
          }
          const ignoreMatch = raw.match(/ignore\s*:\s*\[([\s\S]*?)\]/);
          if (ignoreMatch) {
            const inner = ignoreMatch[1] ?? "";
            for (const m of inner.matchAll(/["']([^"']+)["']/g)) configIgnore.push(m[1]!);
          }
        }
        break;
      } catch {}
    }
  }
  // SvelteKit defaults for 90% without config (like Genesis): deslop false positive for +page.svelte, giant component
  if (Object.keys(configRules).length === 0 && projectInfo.isSvelteKit) {
    configRules["svelte-5-doctor/deslop-unused-file"] = "off";
    configRules["svelte-5-doctor/no-giant-component"] = "warn";
    configRules["svelte-5-doctor/no-nested-snippet"] = "warn";
  }
  // Apply ignore globs from config (simple **/xxx/** and **/*.min.js)
  if (configIgnore.length > 0) {
    const before = files.length;
    files = files.filter((f) => {
      for (const pat of configIgnore) {
        const plain = pat.replace(/^\*\*\//, "").replace(/\/\*\*$/, "").replace(/\*\//g, "");
        if (pat.includes("**/*.min.js") && f.endsWith(".min.js")) return false;
        if (pat.includes("references/**") && f.includes("references/")) return false;
        if (f.includes(plain)) return false;
        // Simple glob: if pat is "references/**" and file starts with "references/"
        if (pat.endsWith("/**") && f.startsWith(pat.replace("/**", "/"))) return false;
      }
      return true;
    });
  }

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

    if (rel.endsWith(".svelte")) {
      try {
        const result = compile(source, { filename: rel, generate: "client" });
        for (const w of result.warnings ?? []) {
          const code = (w as unknown as { code?: string }).code ?? "svelte-warning";
          const isA11y = code.startsWith("a11y");
          const isCss = code === "css_unused_selector";
          let ruleId = `svelte/compiler:${code}`;
          let category: Diagnostic["category"] = "Correctness";
          if (isA11y) { ruleId = `svelte-5-doctor/${code.replaceAll("_", "-")}`; category = "Accessibility"; }
          else if (isCss) { ruleId = "svelte-5-doctor/css-unused-selector"; category = "Maintainability"; }
          else if (code.includes("state") || code.includes("rune")) category = "Correctness";
          else if (code.includes("perf")) category = "Performance";
          const line = (w as unknown as { start?: { line: number; column: number } }).start?.line ?? 1;
          const col = (w as unknown as { start?: { line: number; column: number } }).start?.column ?? 1;
          const msg = (w as unknown as { message: string }).message ?? String(w);
          // Add fix hint for fixable a11y/compiler rules
          let fix: string | undefined;
          if (code === "a11y_label_has_associated_control") fix = "Add for attribute to label or wrap input in label";
          else if (code === "a11y_interactive_supports_focus") fix = "Add tabindex={0} to interactive element";
          else if (code === "a11y_consider_explicit_label") fix = "Add aria-label to button or link";
          else if (code === "a11y_missing_attribute") fix = "Add missing required attribute";
          else if (code === "a11y_autofocus") fix = "Remove autofocus or add aria-live for dynamic content";
          allDiagnostics.push({
            ruleId,
            severity: "warn",
            category,
            message: msg,
            filePath: rel,
            line,
            column: col,
            tags: [code],
            fix,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
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
      }
    }

    const heuristic = runRulesOnFile(rel, source, directory);
    allDiagnostics.push(...heuristic);
  }

  if (input.categories?.length) {
    const set = new Set(input.categories.map((c) => c.toLowerCase()));
    allDiagnostics = allDiagnostics.filter((d) => set.has(d.category.toLowerCase()));
  }

  // svelte-check deduplication — ported from react-doctor/src/build-diagnostic-pipeline.ts dedupeDiagnostics()
  // Compiler warnings via svelte/compiler and heuristic visitors may report same file:line:rule; keep first.
  {
    const seen = new Set<string>();
    const deduped: Diagnostic[] = [];
    for (const d of allDiagnostics) {
      const key = `${d.filePath}:${d.line}:${d.column}:${d.ruleId}`;
      if (!seen.has(key)) { seen.add(key); deduped.push(d); }
    }
    allDiagnostics = deduped;
  }

  // deslop-js dead-code — ported from react-doctor/packages/deslop-js (Knip-like)
  // Find .svelte files never imported (excluding entries + tests/fixtures)
  try {
    const svelteFiles = files.filter((f) => f.endsWith(".svelte") && !f.includes("tests/") && !f.includes("fixtures/") && !f.includes("benchmarking"));
    const imported = new Set<string>();
    for (const rel of files) {
      let src = "";
      try { src = readFileSync(join(directory, rel), "utf-8"); } catch { continue; }
      for (const m of src.matchAll(/from\s+["']([^"']+\.svelte)["']/g)) {
        const imp = m[1]!;
        const base = rel.includes("/") ? rel.substring(0, rel.lastIndexOf("/")) : "";
        const resolved = imp.startsWith(".") ? join(base, imp).replace(/\\/g, "/") : imp;
        imported.add(resolved);
        imported.add(resolved.replace(/^\.\//, ""));
      }
      for (const m of src.matchAll(/import\s+["']([^"']+\.svelte)["']/g)) {
        const imp = m[1]!;
        const base = rel.includes("/") ? rel.substring(0, rel.lastIndexOf("/")) : "";
        const resolved = imp.startsWith(".") ? join(base, imp).replace(/\\/g, "/") : imp;
        imported.add(resolved);
      }
    }
    for (const sf of svelteFiles) {
      const isEntry = sf.includes("src/routes/") || sf.endsWith("+page.svelte") || sf.endsWith("+layout.svelte") || sf.endsWith("+error.svelte") || sf.endsWith("+page.ts") || sf.endsWith("+layout.ts") || sf.endsWith("+server.ts") || sf.endsWith("App.svelte") || sf === "src/App.svelte";
      const norm = sf.replace(/\\/g, "/");
      if (!isEntry && !imported.has(norm) && !imported.has(`./${norm}`) && !imported.has(norm.replace(/^src\//, "$lib/")) && !norm.includes(".svelte-kit/")) {
        // Check if file actually exists and is not entry — report as maintainability
        allDiagnostics.push({
          ruleId: "svelte-5-doctor/deslop-unused-file",
          severity: "warn",
          category: "Maintainability",
          message: `Svelte file '${sf}' never imported — dead code (deslop)`,
          filePath: sf,
          line: 1,
          column: 1,
          tags: ["deslop"],
        });
      }
    }
  } catch {}

  // supply-chain — ported from react-doctor/src/check-supply-chain.ts (Socket.dev) — simplified: outdated svelte + known advisories
  try {
    const pkgPath = join(directory, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const svelteVer = deps.svelte ? String(deps.svelte).replace(/^[^\d]*/, "") : "";
      const major = Number.parseInt(svelteVer.split(".")[0] ?? "0", 10);
      const minor = Number.parseInt(svelteVer.split(".")[1] ?? "0", 10);
      const patch = Number.parseInt(svelteVer.split(".")[2] ?? "0", 10);
      // Outdated check: <5.57.0 (latest as of 2026-08-28)
      if (svelteVer && (major < 5 || (major === 5 && minor < 57))) {
        allDiagnostics.push({
          ruleId: "svelte-5-doctor/supply-chain-outdated-svelte",
          severity: "warn",
          category: "Security",
          message: `svelte ${svelteVer} outdated — latest 5.57.0 (#18692 derived_invalid_export, #18689 a11y focusin/focusout, #18480 undeclared shorthand handlers). Update.`,
          filePath: "package.json",
          line: 1,
          column: 1,
          tags: ["supply-chain"],
        });
      }
      // Known supply-chain: lodash full import already covered, but also check for vulnerable sveltekit <2.70.3
      const kitVer = deps["@sveltejs/kit"] ? String(deps["@sveltejs/kit"]).replace(/^[^\d]*/, "") : "";
      if (kitVer) {
        const kMajor = Number.parseInt(kitVer.split(".")[0] ?? "0", 10);
        const kMinor = Number.parseInt(kitVer.split(".")[1] ?? "0", 10);
        if (kMajor === 2 && kMinor < 70) {
          allDiagnostics.push({
            ruleId: "svelte-5-doctor/supply-chain-outdated-svelte",
            severity: "warn",
            category: "Security",
            message: `@sveltejs/kit ${kitVer} outdated — latest 2.70.3 (eager $app/state leak fix). Update.`,
            filePath: "package.json",
            line: 1,
            column: 1,
            tags: ["supply-chain"],
          });
        }
      }

      // ── Svelte 5.57.0 version-gated features ──
      // Check if svelte < 5.57.0 and code uses new APIs that are silently unavailable
      const needs557 = major === 5 && minor < 57;
      if (needs557) {
        for (const rel of files) {
          if (!rel.endsWith(".svelte") && !rel.endsWith(".svelte.js") && !rel.endsWith(".svelte.ts")) continue;
          let src = "";
          try { src = readFileSync(join(directory, rel), "utf-8"); } catch { continue; }
          // <select defaultValue> — silently ignored before 5.57.0
          if (/defaultValue\s*=/.test(src) && /<select\b/.test(src)) {
            const idx = src.search(/<select\b[^>]*\bdefaultValue\b/);
            allDiagnostics.push({ ruleId: "svelte-5-doctor/version-select-defaultvalue", severity: "warn", category: "Correctness",
              message: `<select defaultValue> requires Svelte 5.57.0+ — currently ignored in ${svelteVer}. Use <option selected> instead, or update Svelte.`,
              filePath: rel, line: idx !== -1 ? src.slice(0, idx).split("\n").length : 1, column: 1, tags: ["migration","version-gate"] });
          }
          // createContext().has() — undefined before 5.57.0
          if (/\.has\s*\(/.test(src) && /createContext/.test(src)) {
            const idx = src.indexOf(".has(");
            allDiagnostics.push({ ruleId: "svelte-5-doctor/version-createcontext-has", severity: "warn", category: "Correctness",
              message: `createContext().has() requires Svelte 5.57.0+ — returns undefined in ${svelteVer}. Check context existence differently, or update Svelte.`,
              filePath: rel, line: idx !== -1 ? src.slice(0, idx).split("\n").length : 1, column: 1, tags: ["migration","version-gate"] });
          }
          // SvelteMap.getOrInsert/getOrInsertComputed — not available before 5.57.0
          if (/getOrInsert/.test(src)) {
            const idx = src.indexOf("getOrInsert");
            allDiagnostics.push({ ruleId: "svelte-5-doctor/version-sveltemap-getorinsert", severity: "warn", category: "Correctness",
              message: `SvelteMap.getOrInsert/getOrInsertComputed requires Svelte 5.57.0+ — not available in ${svelteVer}. Use map.has()/map.get() with fallback, or update Svelte.`,
              filePath: rel, line: idx !== -1 ? src.slice(0, idx).split("\n").length : 1, column: 1, tags: ["migration","version-gate"] });
          }
          // Reading async values in closures inside {#snippet}/{@const} — may crash before 5.57.0
          if (/(?:\{#snippet|\{@const)[^}]*await/.test(src) && /\(\s*(?:\([^)]*\)|[^)]+)\s*\)\s*=>/.test(src)) {
            const idx = src.search(/\{#snippet[^}]*await|\{@const[^}]*await/);
            allDiagnostics.push({ ruleId: "svelte-5-doctor/version-async-values-in-closures", severity: "warn", category: "Correctness",
              message: `Reading async values in closures inside {#snippet}/{@const} may crash in Svelte <5.57.0 (${svelteVer}). Update Svelte to avoid runtime errors.`,
              filePath: rel, line: idx !== -1 ? src.slice(0, idx).split("\n").length : 1, column: 1, tags: ["migration","version-gate"] });
          }
          // bind:this component stored in $state — inconsistent dev/prod before 5.57.0
          if (/bind:this\s*=/.test(src) && /\$state/.test(src)) {
            const idx = src.indexOf("bind:this");
            allDiagnostics.push({ ruleId: "svelte-5-doctor/version-bindthis-component-in-state", severity: "warn", category: "Correctness",
              message: `bind:this component stored in $state may have inconsistent dev/prod behavior in Svelte <5.57.0 (${svelteVer}). Avoid storing component refs in $state, or update Svelte.`,
              filePath: rel, line: idx !== -1 ? src.slice(0, idx).split("\n").length : 1, column: 1, tags: ["migration","version-gate"] });
          }
        }
      }
    }
  } catch {}

  // Apply config rules overrides after all diagnostics (including deslop/supply-chain) — like svelte-5-doctor --config
  for (const d of allDiagnostics) {
    const override = configRules[d.ruleId] ?? configRules[d.ruleId.replace("svelte-5-doctor/", "svelte-doctor/")] ?? configRules[d.ruleId.replace("svelte/compiler:", "svelte-5-doctor/").replace("svelte/compiler:", "svelte-doctor/")] ?? (d.ruleId.startsWith("svelte/compiler:") ? configRules[`svelte-5-doctor/${d.ruleId.split(":")[1]?.replaceAll("_", "-")}`] : undefined);
    if (override === "off") (d as unknown as { severity: string }).severity = "off";
    else if (override === "warn") d.severity = "warn";
    else if (override === "error") d.severity = "error";
  }
  allDiagnostics = allDiagnostics.filter((d) => (d as unknown as { severity: string }).severity !== "off");

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
