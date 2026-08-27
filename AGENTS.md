# AGENTS.md — Svelte Doctor

> Ported from react-doctor-source/AGENTS.md (design source of truth).

## General Rules

- MUST: Use `ni` (`@antfu/ni`) to install, `nr SCRIPT_NAME` to run, `nun` to uninstall.
- MUST: Use TypeScript interfaces over types; keep types in global scope.
- MUST: Use arrow functions over function declarations.
- MUST: Never comment unless absolutely necessary — prefix hacks with `// HACK:`
- MUST: Use kebab-case for files; descriptive variable names.
- MUST: Use `truffler` to find existing symbols before adding utilities.
- MUST: Search codebase, think of many solutions, then implement most *elegant*.
- MUST: Keep `svelte/compiler` as the AST source of truth (not oxlint).
- MUST: Keep CLI parity with React Doctor: same flags, same JSON schemaVersion:3, same 0-100 scoring.

## Package Layout

```
packages/
  core/                          # @svelte-doctor/core — diagnostic engine (svelte/compiler)
  svelte-doctor/                 # CLI (svelte-doctor bin)
  svelte-plugin-svelte-doctor/   # 48 rules — port of oxlint-plugin-react-doctor (287 rules)
  eslint-plugin-svelte-doctor/   # ESLint flat-config wrapper
```

## Rule Authoring

Create `src/rules/<bucket>/<id>.ts` with `defineRule({ id, category, create })`, then `pnpm gen` regenerates registry.

## Svelte 5 Notes (verified via exhaustive web search)

- Runes are compiler keywords, not imports: `$state`, `$derived`, `$effect`, `$props`, `$bindable`, `$inspect`.
- `.svelte.js/.svelte.ts` modules with top-level `$state` leak across SSR — use context or getters.
- `on:click` → `onclick`, `<slot>` → `{#snippet}` + `{@render}`, `export let` → `$props()`.
- `{@html}` preserves TrustedHTML in 5.52+; always sanitize with DOMPurify.
- Effects are client-only escape hatch; prefer `$derived` and `onclick` handlers.
