# How to Write a Svelte Doctor Rule

> Ported from `react-doctor-source/docs/HOW_TO_WRITE_A_RULE.md`. Design source truth: React Doctor.

## Workflow — same as React Doctor, new AST

1. **Search before you add** — run truffler to reuse helpers:
   ```bash
   bunx @rayhanadev/truffler "no-at-html" packages --kind function --limit 20
   ```

2. **Create single file** `packages/svelte-plugin-svelte-5-doctor/src/rules/<bucket>/<id>.ts` or add to `svelte-5-doctor-core/src/rules/registry.ts`:

   ```ts
   import { defineRule } from "../define-rule.js";

   export const noAtHtmlXss = defineRule({
     id: "svelte-5-doctor/no-at-html-xss",
     category: "Security",
     severity: "error",
     description: "Disallows unsanitized {@html}",
     create: (ctx) => {
       for (const m of ctx.source.matchAll(/\{@html\s+([^}]+)\}/g)) {
         ctx.report({ ruleId: "svelte-5-doctor/no-at-html-xss", severity: "error", category: "Security", message: `{@html} XSS — sanitize`, line: 1, column: 1 });
       }
     },
   });
   ```

   Buckets (mirrors React Doctor): `security/`, `correctness/`, `performance/`, `a11y/`, `architecture/`.

3. **Framework inference:** directory → `framework` tag (`svelte5` → only runs on `.svelte`, `global` → all files). Default category inferred from bucket dir.

4. **Regenerate registry:** `pnpm gen` runs `scripts/generate-rule-registry.mjs` → `rule-registry.ts` (287 React rules → 52 Svelte first wave).

5. **Add fixture:** `packages/core/tests/fixtures/<ruleId>/bad.svelte` + `good.svelte` — auto-tested.

6. **Verify:** `pnpm test && pnpm typecheck && pnpm lint`.

## Svelte 5 AST tips (vs React JSX)

| React Doctor | Svelte Doctor |
|--------------|---------------|
| `oxlint` (Rust) visits JSX | `svelte/compiler` `compile()` warnings + `parse(source,{modernAst:true})` + text heuristics |
| `ctx.report()` with `node.loc` | Use `lineColFromIndex(source, match.index)` — Svelte AST nodes have `start/end` offsets |
| `Scope changed` disables deslop | `runInspect({ scope:"changed" })` needs `git diff`; MVP no-op, wire via `get-diff-files.ts` port |

See `docs/svelte-5-porting-map.md` for React→Svelte rule translation table.
