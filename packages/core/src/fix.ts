/**
 * Fix engine — ported from React Doctor (oxlint --fix) + Bun 1.4 --fix
 * Applies fixable diagnostics to source files, like `bun lint --fix` and `oxlint --fix`.
 * Fixable in 0.4.0: Svelte 4 deprecation (export let, $:, on:click, <slot>), unused CSS, a11y, rune parens.
 * Design: collect fixable diagnostics per file, sort by location descending to avoid offset shifts,
 * apply text edits. For multi-export-let, coalesce into single $props destructuring.
 */
import type { Diagnostic } from "./schemas.js";

export interface FixResult {
  filePath: string;
  original: string;
  fixed: string;
  applied: number;
  skipped: number;
}

const FIXABLE = new Set<string>([
  "svelte-5-doctor/legacy-export-let",
  "svelte-5-doctor/legacy-dollars-colon",
  "svelte-5-doctor/legacy-event-directive",
  "svelte-5-doctor/legacy-slot",
  "svelte-5-doctor/rune-requires-parens",
  "svelte-5-doctor/css-unused-selector",
  "svelte-5-doctor/a11y-missing-attribute",
  "svelte-5-doctor/props-invalid-placement",
  "svelte-5-doctor/bindable-invalid-location",
  "svelte-5-doctor/store-rune-conflict",
  "svelte-5-doctor/attribute-sequence",
  "svelte-5-doctor/each-item-assignment",
  "svelte-5-doctor/each-item-mutation",
  "svelte-5-doctor/compile-error",
  "svelte-5-doctor/no-at-html-xss",
  "svelte-5-doctor/no-index-as-key",
  "svelte-5-doctor/snapshot-required",
]);

export const isFixable = (ruleId: string): boolean => FIXABLE.has(ruleId) || FIXABLE.has(ruleId.replace("svelte-5-doctor/", "svelte-doctor/"));

export const applyFixes = (filePath: string, source: string, diagnostics: Diagnostic[]): FixResult => {
  const fixable = diagnostics.filter((d) => d.filePath === filePath && isFixable(d.ruleId) && d.fix);
  if (fixable.length === 0) {
    // Also handle fixable without d.fix but with known fixer (a11y, CSS, etc.)
    const implicitFixable = diagnostics.filter((d) => d.filePath === filePath && isFixable(d.ruleId));
    if (implicitFixable.length === 0) return { filePath, original: source, fixed: source, applied: 0, skipped: 0 };
  }

  let fixed = source;
  let applied = 0;
  let skipped = 0;

  // Sort descending by line:col to avoid offset shifts (like oxlint fixers)
  const sorted = [...diagnostics]
    .filter((d) => d.filePath === filePath && isFixable(d.ruleId))
    .sort((a, b) => b.line - a.line || b.column - a.column);

  // Special: legacy-export-let coalesce — only for .svelte, not .svelte.ts/.svelte.js
  // Defer until after other fixes to avoid line-number shift. Also handles <slot> -> children prop coalescing (like Bun 1.4 codemod).
  const hadSlot = source.includes("<slot");
  const exportLetDiags = sorted.filter((d) => d.ruleId.includes("legacy-export-let"));
  let deferredExportLetFix: (() => void) | null = null;
  if ((exportLetDiags.length > 0 || hadSlot) && filePath.endsWith(".svelte") && !filePath.endsWith(".svelte.ts") && !filePath.endsWith(".svelte.js")) {
    deferredExportLetFix = () => {
      const exportLets = [...fixed.matchAll(/export\s+let\s+(\w+)(?:\s*:\s*[^=;\n]+)?(?:\s*=\s*([^;\n]+))?;?/g)];
      const hasExportLets = exportLets.length > 0;
      const needsChildren = hadSlot && !fixed.includes("children");
      if (hasExportLets || needsChildren) {
        const propsEntries: string[] = [];
        const typeEntries: string[] = [];
        for (const m of exportLets) {
          const full = m[0];
          const name = m[1]!;
          const def = m[2]?.trim();
          const typeMatch = full.match(/export\s+let\s+\w+\s*:\s*([^=;\n]+)/);
          const type = typeMatch?.[1]?.trim();
          if (type) typeEntries.push(`${name}: ${type}`);
          propsEntries.push(def ? `${name} = ${def}` : name);
        }
        if (needsChildren) {
          propsEntries.push("children");
          typeEntries.push("children?: Snippet");
          // Ensure Snippet import exists
          if (!fixed.includes('from "svelte"') || !fixed.includes("Snippet")) {
            // Will be added below via slot handling, but ensure here
          }
        }
        const hasTypes = typeEntries.length > 0;
        const propsDestructure = hasTypes
          ? `let { ${propsEntries.join(", ")} }: { ${typeEntries.join("; ")} } = $props();`
          : `let { ${propsEntries.join(", ")} } = $props();`;
        let newSource = fixed;
        if (hasExportLets) {
          let first = true;
          for (const m of exportLets) {
            if (first) {
              newSource = newSource.replace(m[0], propsDestructure);
              first = false;
            } else {
              newSource = newSource.replace(m[0], "");
            }
          }
        } else if (needsChildren) {
          const scriptMatch = newSource.match(/<script[^>]*>/);
          if (scriptMatch && scriptMatch.index !== undefined) {
            const insertPos = scriptMatch.index + scriptMatch[0].length;
            const importSnippet = `import type { Snippet } from "svelte";\n  `;
            newSource = newSource.slice(0, insertPos) + "\n  " + importSnippet + propsDestructure + newSource.slice(insertPos);
            applied += 1; // for children
            fixed = newSource;
            return;
          }
        }
        newSource = newSource.replace(/^\s*:\s*\w+[^;\n]*;?\s*$/gm, "");
        newSource = newSource.replace(/\n\s*\n\s*\n/g, "\n\n");
        // Add Snippet import if needed for children
        if (needsChildren && !newSource.includes('Snippet')) {
          newSource = newSource.replace(/<script[^>]*>/, (m) => `${m}\n  import type { Snippet } from "svelte";`);
        }
        fixed = newSource;
        applied += exportLets.length;
        if (needsChildren && !hasExportLets) applied += 1;
        else if (needsChildren) applied += 1;
      }
    };
    // Remove from sorted so they don't get double-processed; will be handled deferred
    for (const d of exportLetDiags) {
      const idx = sorted.indexOf(d);
      if (idx !== -1) sorted.splice(idx, 1);
    }
  }

  for (const d of sorted) {
    try {
      const before = fixed;
      if (d.ruleId.includes("legacy-event-directive")) {
        // on:click={handler} -> onclick={handler}
        fixed = fixed.replace(/on:(\w+)\s*=/g, (m, ev) => `on${ev}=`);
        if (fixed !== before) applied++;
        else skipped++;
      } else if (d.ruleId.includes("legacy-dollars-colon")) {
        const lines = fixed.split("\n");
        const idx = d.line - 1;
        const rawLine = lines[idx] ?? "";
        if (!rawLine.trim().startsWith("$:")) {
          // Debug: log why skipped
          // console.log(`skip $: not start ${JSON.stringify(rawLine)} at ${d.line}`);
          skipped++;
        } else {
          const m = rawLine.match(/\$:\s*(?:let\s+)?(\w+)\s*=\s*(.+)/);
          if (m) {
            const v = m[1]!;
            let expr = m[2]!;
            expr = expr.split("//")[0]!.trim().replace(/;?\s*$/, "").replace(/;$/, "").trim();
            if (expr.endsWith(";")) expr = expr.slice(0, -1).trim();
            const replacement = `let ${v} = $derived(${expr})`;
            lines[idx] = rawLine.replace(/\$:\s*(?:let\s+)?\w+\s*=\s*.+/, replacement);
            fixed = lines.join("\n");
            applied++;
          } else {
            console.log(`[fix] skip $: no match line ${d.line} rawLine=${JSON.stringify(rawLine)}`);
            skipped++;
          }
        }
      } else if (d.ruleId.includes("legacy-slot")) {
        if (fixed.includes("<slot")) {
          fixed = fixed.replace(/<slot\s*\/>/g, "{@render children?.()}")
                       .replace(/<slot\s*name="(\w+)"\s*\/>/g, "{@render $1?.()}")
                       .replace(/<slot\s*name="(\w+)"\s*><\/slot>/g, "{@render $1?.()}")
                       .replace(/<slot><\/slot>/g, "{@render children?.()}")
                       .replace(/<slot>/g, "{@render children?.()}")
                       .replace(/<\/slot>/g, "");
          // Ensure children prop — defer to export-let coalesce if that will run, to avoid duplicate $props()
          const shouldDeferChildren = hadSlot && exportLetDiags.length > 0 && filePath.endsWith(".svelte") && !filePath.endsWith(".svelte.ts");
          if (!shouldDeferChildren && (!fixed.includes("children") || !fixed.includes("$props"))) {
            if (fixed.includes("$props()")) {
              fixed = fixed.replace(/let\s*\{\s*([^}]*)\}\s*=\s*\$props\(\)/, (m, inner) => {
                if (inner.includes("children")) return m;
                return `let { ${inner ? inner + ", " : ""}children } = $props()`;
              });
            } else if (fixed.includes("<script")) {
              fixed = fixed.replace(/<script[^>]*>/, (m) => `${m}\n  import type { Snippet } from "svelte";\n  let { children }: { children?: Snippet } = $props();`);
            }
          }
          if (fixed !== before) applied++; else skipped++;
        }
      } else if (d.ruleId.includes("rune-requires-parens")) {
        // $state -> $state() etc.
        fixed = fixed.replace(/\$(state|derived|effect|props|bindable|inspect)(?!\s*[\(.])/g, (m, name) => `$${name}()`);
        if (fixed !== before) applied++; else skipped++;
      } else if (d.ruleId.includes("css-unused-selector")) {
        // Remove unused selector block: find line with selector and remove next block
        const lines = fixed.split("\n");
        const idx = d.line - 1;
        if (lines[idx] && d.message.includes("Unused")) {
          // Find selector text from message: "Unused CSS selector '.foo'"
          const selMatch = d.message.match(/['\"]([^'\"]+)['\"]/);
          const sel = selMatch?.[1];
          if (sel) {
            // Remove lines containing selector
            const newLines = lines.filter((l) => !l.includes(sel));
            if (newLines.length !== lines.length) {
              fixed = newLines.join("\n");
              applied++;
            } else skipped++;
          } else {
            // Fallback: remove that line
            lines.splice(idx, 1);
            fixed = lines.join("\n");
            applied++;
          }
        }
      } else if (d.ruleId.includes("a11y-missing-attribute")) {
        if (d.message.includes("<img>")) {
          fixed = fixed.replace(/<img\b([^>]*?)>/gi, (m, attrs) => {
            if (/\balt\s*=/.test(attrs)) return m;
            const hasSlash = /\s*\/\s*$/.test(attrs);
            const cleanAttrs = attrs.replace(/\s*\/\s*$/, "");
            return `<img${cleanAttrs} alt=""${hasSlash ? " /" : ""}>`;
          });
          if (fixed !== before) applied++; else skipped++;
        } else if (d.message.includes("<a>")) {
          fixed = fixed.replace(/<a\b(?![^>]*\bhref=)([^>]*?)>/gi, (m, attrs) => {
            const hasSlash = /\s*\/\s*$/.test(attrs);
            const cleanAttrs = attrs.replace(/\s*\/\s*$/, "");
            return `<a${cleanAttrs} href="#"${hasSlash ? " /" : ""}>`;
          });
          if (fixed !== before) applied++; else skipped++;
        }
      } else if (d.ruleId.includes("attribute-sequence")) {
        fixed = fixed.replace(/(\w+)\s*=\s*\{\s*(\w+)\s*,\s*(\w+)\s*\}/g, `$1={[$2, $3]}`);
        if (fixed !== before) applied++; else skipped++;
      } else if (d.ruleId.includes("each-item-assignment") || d.ruleId.includes("each-item-mutation") || (d.ruleId.includes("compile-error") && d.message.includes("each block argument"))) {
        const eachMatch = fixed.match(/\{#each\s+(\w+)\s+as\s+(\w+)(?:\s*,\s*\w+)?\s*\}/);
        if (eachMatch) {
          const arr = eachMatch[1]!;
          const item = eachMatch[2]!;
          if (!eachMatch[0].includes(",")) {
            fixed = fixed.replace(/\{#each\s+(\w+)\s+as\s+(\w+)\s*\}/, `{#each $1 as $2, i}`);
          }
          const beforeEach = fixed;
          fixed = fixed.replace(new RegExp(`bind:value=\\{${item}\\}`, "g"), `bind:value={${arr}[i]}`);
          fixed = fixed.replace(new RegExp(`\\b${item}\\s*=\\s*`, "g"), `${arr}[i] = `);
          if (fixed !== beforeEach) applied++; else skipped++;
        } else skipped++;
      } else if (d.ruleId.includes("no-at-html-xss")) {
        const before2 = fixed;
        if (!fixed.includes("DOMPurify") && !fixed.includes("dompurify")) {
          if (fixed.includes("<script")) {
            fixed = fixed.replace(/<script[^>]*>/, (m) => `${m}\n  import DOMPurify from 'isomorphic-dompurify';`);
          }
        }
        fixed = fixed.replace(/\{@html\s+([^\}]+)\}/g, (m, expr) => {
          if (expr.includes("DOMPurify.sanitize") || expr.includes("TrustedHTML")) return m;
          return `{@html DOMPurify.sanitize(${expr.trim()})}`;
        });
        if (fixed !== before2) applied++; else skipped++;
      } else if (d.ruleId.includes("no-index-as-key")) {
        const before2 = fixed;
        fixed = fixed.replace(/\{#each\s+(\w+)\s+as\s+(\w+)\s*\}/g, (m, arr, item) => {
          if (m.includes("(")) return m;
          return `{#each ${arr} as ${item} (${item}.id)}`;
        });
        fixed = fixed.replace(/\{#each\s+(\w+)\s+as\s+(\w+)\s*,\s*(\w+)\s*\}/g, (m, arr, item, idx) => {
          if (m.includes("(")) return m;
          return `{#each ${arr} as ${item}, ${idx} (${item}.id)}`;
        });
        if (fixed !== before2) applied++; else skipped++;
      } else if (d.ruleId.includes("snapshot-required")) {
        const before2 = fixed;
        const varMatch = d.message.match(/'([^']+)'/);
        const v = varMatch?.[1];
        if (v) {
          const orig = fixed;
          fixed = fixed.replace(new RegExp(`structuredClone\\s*\\(\\s*${v}\\s*\\)`, "g"), `structuredClone($state.snapshot(${v}))`);
          fixed = fixed.replace(new RegExp(`JSON\\.stringify\\s*\\(\\s*${v}\\s*\\)`, "g"), `JSON.stringify($state.snapshot(${v}))`);
          fixed = fixed.replace(new RegExp(`postMessage\\s*\\(\\s*${v}\\s*\\)`, "g"), `postMessage($state.snapshot(${v}))`);
          if (fixed === orig) {
            // Fallback: wrap bare variable in external call context
            fixed = fixed.replace(new RegExp(`\\b${v}\\b`, "g"), `$state.snapshot(${v})`);
            // But that would over-replace, so revert if too many
            if ((fixed.match(new RegExp(`\\$state\\.snapshot\\(${v}\\)`, "g")) || []).length > 3) fixed = orig;
          }
        }
        if (fixed !== before2) applied++; else skipped++;
      } else if (d.fix) {
        // Generic: if diagnostic has fix string that is a direct replacement, try to apply
        // For now, skip generic to avoid incorrect edits
        skipped++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  if (deferredExportLetFix) deferredExportLetFix();

  return { filePath, original: source, fixed, applied, skipped };
};

export const fixableRuleIds = [...FIXABLE];
