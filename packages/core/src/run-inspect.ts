/**
 * Run Inspect — heart of Svelte Doctor diagnostic pipeline
 * Ported from react-doctor-source/packages/core/src/run-inspect.ts
 * Perfection 2026-08-27: Svelte 5.56.10, 71 rules, 21 high-priority + 5 Kit
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { glob } from "tinyglobby";
import { compile } from "svelte/compiler";
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
        report("svelte-5-doctor/legacy-export-let", "`export let` is invalid in runes mode — use `let { prop } = $props()`", m.index ?? 0, "let { prop } = $props()");
      }
    }
    for (const m of source.matchAll(/\$\s*:\s*\w+/g)) {
      if (isRunesFile) report("svelte-5-doctor/legacy-dollars-colon", "`$:` reactive statement is invalid in runes mode — use $derived / $effect", m.index ?? 0);
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
  // rune missing parens: $state without () or $derived without () — strip comments to avoid false positives in // $state docs
  const sourceNoComments = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of sourceNoComments.matchAll(/\$(state|derived|effect|props|bindable|inspect)(?!\s*\()/g)) {
    const full = m[0];
    // allow $effect.pending, $effect.tracking, $state.snapshot etc
    if (/\$(state|effect)\.(snapshot|eager|raw|pending|tracking|root)/.test(full)) continue;
    if (full === "$props" || full === "$host") continue;
    const after = sourceNoComments.slice((m.index ?? 0) + full.length, (m.index ?? 0) + full.length + 5);
    if (!after.trim().startsWith("(") && !after.trim().startsWith(".")) {
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
  // experimental-async: await in template or $derived without flag
  if (/\bawait\b/.test(source) && (/\$derived.*await/.test(source) || /\{@await/.test(source) || /\{#await/.test(source))) {
    const hasFlag = /experimental\s*:\s*\{\s*async\s*:\s*true/.test(source) || source.includes("experimental.async");
    // check svelte.config.js would have flag, but we heuristic: if await in .svelte and no flag in source, report
    if (!hasFlag && isSvelte) {
      const idx = source.indexOf("await");
      // only report if file has await in derived/template and not in .js with flag
      report("svelte-5-doctor/experimental-async", "await in $derived/template needs svelte.config.js compilerOptions.experimental.async:true", idx);
    }
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
  // bindable-mutation-without-bindable: prop mutated without $bindable
  for (const pv of propsVars) {
    if (bindableVars.has(pv)) continue;
    const re = new RegExp(`\\b${pv}\\s*\\.\\w+\\s*(=|\\+=|\\+\\+)|\\b${pv}\\s*=\\s*[^=]`);
    const m = re.exec(source);
    if (m) {
      const idx = m.index ?? source.indexOf(pv);
      // ensure it's mutation not just read
      if (source.slice(idx, idx + 50).includes("=") || source.slice(idx, idx + 50).includes("++")) {
        // check if it's inside $props area? crude: if file has $props and pv is prop, and mutation exists
        if (new RegExp(`\\b${pv}\\b.*=.*`).test(source)) {
          // avoid false positive for let {pv} = $props() itself
          const afterProps = source.indexOf("$props()");
          const mutIdx = source.indexOf(pv, afterProps + 10);
          if (mutIdx !== -1 && source.slice(mutIdx, mutIdx + 100).match(/\.|\+|=/)) {
            report("svelte-5-doctor/bindable-mutation-without-bindable", `Prop '${pv}' mutated without $bindable — mark let {${pv}=$bindable()} or use callback prop`, idx);
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
  for (const m of source.matchAll(/transition:\w+[^}]*width|animate:[^;]*width|style:[^;]*width/g))
    if (/width|height|top|left/.test(m[0])) report("svelte-5-doctor/no-layout-animation", "Animating layout properties causes thrash — use transform/opacity.", m.index ?? 0);
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
  if (/from\s+['"]\$app\/state['"]/.test(source) && /import\s*\{[^}]*page[^}]*\}\s*from\s*['"]\$app\/state['"]/.test(source)) {
    // check eager read at top-level
    const importIdx = source.indexOf("$app/state");
    const afterImport = source.slice(importIdx, importIdx + 500);
    if (/page\.url|page\.params|page\.data/.test(afterImport) && !/\$effect|onMount/.test(source.slice(importIdx, importIdx + 1000))) {
      report("svelte-5-doctor/kit-app-state-eager-init", "$app/state read at module top-level — move inside $effect/onMount to avoid eager leak (2.70.3)", importIdx);
    }
  }

  // ── Maintainability ──
  if (lines.length > GIANT_COMPONENT_THRESHOLD_LINES)
    report("svelte-5-doctor/no-giant-component", `Component is ${lines.length} lines (threshold ${GIANT_COMPONENT_THRESHOLD_LINES}) — split via snippets/composition.`, 0);
  for (const m of source.matchAll(/\{#if[\s\S]*?\{#snippet|\{#each[\s\S]*?\{#snippet/g))
    report("svelte-5-doctor/no-nested-snippet", "Snippet defined inside markup recreates each render — hoist to top-level.", m.index ?? 0);

  // ── a11y ──
  for (const m of source.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) report("svelte-5-doctor/a11y-missing-attribute", "<img> missing alt attribute.", m.index ?? 0);
  for (const m of source.matchAll(/<a\b(?![^>]*\bhref=)[^>]*>/gi)) report("svelte-5-doctor/a11y-missing-attribute", "<a> missing href.", m.index ?? 0);
  for (const m of source.matchAll(/onclick\s*=\s*\{[^}]+\}(?![^<]*onkeydown)/gi)) {
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

    const heuristic = runRulesOnFile(rel, source);
    allDiagnostics.push(...heuristic);
  }

  if (input.categories?.length) {
    const set = new Set(input.categories.map((c) => c.toLowerCase()));
    allDiagnostics = allDiagnostics.filter((d) => set.has(d.category.toLowerCase()));
  }

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
