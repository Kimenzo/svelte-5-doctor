# Svelte 5 Porting Map — React Doctor → Svelte Doctor

> Exhaustive translation table from the `explore` research report (10 web searches, svelte.dev verified).

## Engine

| React Doctor | Svelte Doctor |
|--------------|---------------|
| `oxlint` (Rust, near-instant) + `deslop-js` (Knip-like dead code) | `svelte/compiler` `compile()` + `parse()` + heuristic visitors |
| `batchIncludePaths` + `spawnLintBatches` + `OXLINT_SPAWN_TIMEOUT_MS` | `tinyglobby` + sequential file loop (MVP; batch + worker parity roadmap) |
| `createOxlintConfig()` temp oxlintrc.json | Direct rule loop in `run-inspect.ts` `runRulesOnFile()` |
| `doctor.config.*` layered per-project | `svelte-5-doctor.config.ts` (roadmap) |

## Rule Translation (287 → 52 first wave)

| # | React Doctor Rule | Svelte Doctor Rule | What It Detects |
|---|-------------------|---------------------|-----------------|
| **Security** |
| 1 | `no-danger` (`dangerouslySetInnerHTML`) | `no-at-html-xss` | `{@html raw}` without `DOMPurify` / `TrustedHTML` |
| 2 | `no-eval` | `no-eval` | `eval()` / `new Function()` |
| 3 | `no-secrets-in-client-code` | `no-secrets-in-client-code` | Hardcoded `apiKey = "..."` in `.svelte` |
| 4 | — (new CVE) | `dom-clobbering-risk` | `{...spread}` on `<input name>` inside `<form>` (CVE-2026-42573) |
| 5 | `iframe-missing-sandbox` | `iframe-missing-sandbox` | `<iframe>` without `sandbox` |
| **Correctness — legacy** |
| 6 | — | `legacy-export-let` | `export let` in runes mode (`legacy_export_invalid`) |
| 7 | — | `legacy-dollars-colon` | `$:` in runes mode |
| 8 | — | `legacy-event-directive` | `on:click` → `onclick` |
| 9 | — | `legacy-slot` | `<slot>` → `{#snippet}` |
| 10 | — | `mixed-event-syntax` | Mixing both syntaxes |
| 11 | — | `slot-snippet-conflict` | Mixing `<slot>` + `{@render}` |
| **Correctness — runes** |
| 12 | `no-mutable-in-deps` | `rune-invalid-placement` | `$state` outside component |
| 13 | — | `state-invalid-export` | `export let x=$state()` reassigned in `.svelte.js` (SSR leak) |
| 14 | — | `props-invalid-placement` | `$props()` not top-level destructuring |
| 15 | — | `bindable-invalid-location` | `$bindable()` outside `$props()` |
| 16 | — | `derived-invalid-export` | Exporting `$derived` from module |
| 17 | — | `store-rune-conflict` | `$count` shadow |
| 18 | `non_reactive_update` | `non-reactive-update` | `let x` mutated but not `$state` |
| 19 | `state_referenced_locally` | `state-referenced-locally` | `setContext('k', state)` snapshot |
| 20 | — | `each-item-mutation` | `bind:value={entry}` in `{#each}` |
| **Correctness — effects (from you-might-not-need-an-effect)** |
| 21 | `no-derived-state` | `no-effect-derived` | `$effect(()=> x= y*2)` → `$derived` |
| 22 | `no-chain-state-updates` | `no-effect-chain` | Chained `$effect` syncing |
| 23 | `effect-needs-cleanup` | `effect-needs-cleanup` | Missing `return ()=>clearInterval` |
| 24 | `no-mutable-in-deps` | `no-mutate-in-derived` | Mutation inside `$derived` |
| **Performance** |
| 25 | `no-array-index-as-key` | `no-index-as-key` | `{#each}` without `(id)` |
| 26 | `perf_avoid_inline_class` | `perf-avoid-inline-class` | `new class` inside `$effect` |
| 27 | `no-layout-property-animation` | `no-layout-animation` | `width` animation |
| 28 | `no-transition-all` | `no-transition-all` | `transition:all` |
| 29 | `js-*` (flatmap, hoist-regexp/intl) | `js-*` (identical) | Loop perf |
| 30 | `no-barrel-import` | `no-barrel-import` | Barrel import |
| **Maintainability** |
| 31 | `no-giant-component` | `no-giant-component` | >400 lines |
| 32 | `no-nested-component-definition` | `no-nested-snippet` | Snippet inside `{#if}` |
| **Accessibility** |
| 33 | `jsx_a11y` 30+ rules | `a11y_*` via `compile()` warnings | `alt`, `href`, `click→key` |

Full Svelte 5 deep dive (runes reference, snippets, events, SSR leaks, TrustedHTML) in the research report saved at
`C:\Users\admin\.local\share\opencode\tool-output\tool_...` — see session artifacts.
