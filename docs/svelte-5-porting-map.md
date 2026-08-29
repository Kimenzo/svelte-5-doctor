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

## Svelte 5.57.0 Updates (2026-08-28)

> Complete changelog. 4 minor features, 43 patch fixes.
> Svelte Doctor adds version-gated rules so users on older Svelte versions get warnings when using 5.57.0+ APIs.

### Minor Changes (New Features)

| # | PR | Change | Svelte Doctor Rule | Notes |
|---|-----|--------|--------------------|-------|
| 34 | #18648 | Export `RenderOutput`, `SyncRenderOutput`, `Csp`, `Sha256Source` from `svelte/server` | — | Server-only types, no rule needed |
| 35 | #18472 | `createContext` returns `[get, set, has]` triplet | `version-createcontext-has` (version-gated) | `has()` unavailable before 5.57.0 |
| 36 | #18591 | `<select defaultValue>` now works | `version-select-defaultvalue` (version-gated) | Silently ignored before 5.57.0 |
| 37 | #18728 | `SvelteMap.getOrInsert/getOrInsertComputed` | `version-sveltemap-getorinsert` (version-gated) | Not available before 5.57.0 |

### Patch Changes (Bug Fixes)

| # | PR | Change | Svelte Doctor Rule | Category |
|---|-----|--------|--------------------|----------|
| 38 | #18582 | Block template store subscriptions on promise that assigns store | — | Runtime fix |
| 39 | #18486 | Route `$derived` teardown errors through `invoke_error_boundary` | — | Runtime fix |
| 40 | #18700 | Track `SvelteDate` snapshots in reactions | — | Runtime fix |
| 41 | #18697 | Remove `<svelte:head>` anchors on unmount | — | Memory leak fix |
| 42 | #18480 | Warn on undeclared shorthand event handlers on `<svelte:window/document/body>` | `special-element-undeclared-handler` | **New detection** |
| 43 | #18713 | Reuse cached value in `<option>`/`<select>` value guard | — | Perf fix |
| 44 | #18449 | Prevent malformed AST output for `<select>` with static `value` | — | AST fix |
| 45 | #18718 | Apply ownership mutation ignores to binding assignments | — | Compiler fix |
| 46 | #18655 | Prevent `onoutroend` firing twice with `compilerOptions.hmr` | — | HMR fix |
| 47 | #18685 | Preserve whitespace after inline elements when printing | — | Printer fix |
| 48 | #18712 | Fold SSR block-open markers into branch's first push | — | SSR perf |
| 49 | #18585 | Run `onDestroy` callbacks when server render throws | — | SSR fix |
| 50 | #18692 | Report `derived_invalid_export` for `export let x = $derived(...)` | `derived-invalid-export` (updated) | **Updated detection** |
| 51 | #18160 | Never apply class hash to elements inside `<svelte:head>` | — | CSS fix |
| 52 | #18701 | Keep `defaultChecked` on hydrated radio inputs with spread | — | Hydration fix |
| 53 | #18689 | Accept `onfocusin`/`onfocusout` in `a11y_mouse_events_have_key_events` | `a11y-mouse-events-have-key-events` | **New rule** |
| 54 | #18602 | O(n²)→O(n) Map lookups for legacy `$:` reactive statement ordering | — | Perf fix |
| 55 | #18466 | Distinct memoizer on style/class directives | — | Compiler fix |
| 56 | #18647 | Measure nested transitions before applying starting styles | — | Transition fix |
| 57 | #18646 | Don't turn component instances stored in `$state` into state proxies | `version-bindthis-component-in-state` (version-gated) | **Runtime fix + version-gate** |
| 58 | #18717 | Emit `$.only_child` for elements with a single child | — | Perf fix |
| 59 | #18724 | Omit `bind:focused` from SSR output | — | SSR fix |
| 60 | #18710 | More robust rendering of Svelte custom element slots | — | Custom elements fix |
| 61 | #18390 | Optimize simple object destructuring in `@const` tags | — | Perf fix |
| 62 | #18727 | Properly apply static textarea value attribute during CSR | — | CSR fix |
| 63 | #18694 | End a restored reaction context at the end of its synchronous segment | — | Runtime fix |
| 64 | #18703 | Keep dependencies of a reaction that throws | — | Runtime fix |
| 65 | #18431 | Don't resurrect outroing elements when ancestor block is paused/resumed | — | Runtime fix |
| 66 | #18714 | Use `$.comment()` for single-comment templates | — | Perf fix |
| 67 | #18730 | Move `@types/trusted-types` to devDependencies | — | Chore |
| 68 | #18251 | Store setters cache as `Set` instead of `Array` | — | Perf fix |
| 69 | #18669 | Transform derived assignments and select function bindings correctly during SSR | — | SSR fix |
| 70 | #18721 | Keep boolean attributes with empty string value when rendering attribute objects on server | — | SSR fix |
| 71 | #18705 | Sync `SvelteURL` port signal when protocol setter clears port | — | Runtime fix |
| 72 | #18533 | Block declaration tags and `{@const}` on async values read inside closures | `version-async-values-in-closures` (version-gated) | **Compiler fix + version-gate** |
| 73 | #18540 | Avoid CSS tree-shaking for exported Snippet | — | CSS fix |
| 74 | #18711 | Treat `<img loading>` as a static element again | — | Perf fix |
| 75 | #18495 | Prevent `selectedcontent` mutation from changing selected option | — | Runtime fix |
| 76 | #18430 | Avoid NaN keyframe values in `slide` transition | — | Transition fix |
| 77 | #18691 | Preserve line feed character references in attribute values | — | Printer fix |
| 78 | #18708 | Decode uppercase-X hex numeric character references | — | Parser fix |
| 79 | #18534 | Clarify when `$effect.pre` runs relative to DOM updates | — | Docs |
| 80 | #18593 | Scope SSR boundary failed snippets to their boundary | — | SSR fix |

Full Svelte 5 deep dive (runes reference, snippets, events, SSR leaks, TrustedHTML) in the research report saved at
`C:\Users\admin\.local\share\opencode\tool-output\tool_...` — see session artifacts.
