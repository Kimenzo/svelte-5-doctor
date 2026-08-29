/**
 * Rule Registry — ported from react-doctor-source/packages/oxlint-plugin-react-doctor/src/plugin/rule-registry.ts
 * Generated via `pnpm gen` in React Doctor; here we hand-author Svelte 5 equivalents.
 * 287 React rules → 52 Svelte Doctor rules (first wave). Categories + severity mirrored.
 */
import type { RuleMeta } from "../types.js";

export const SVELTE_DOCTOR_RULES: RuleMeta[] = [
  // ── Security (mirrors react-doctor/security + no-eval, no-secrets) ──
  { id: "svelte-5-doctor/no-at-html-xss", category: "Security", severity: "error", description: "Disallows unsanitized {@html} — use DOMPurify or TrustedHTML", tags: ["security","xss"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-eval", category: "Security", severity: "error", description: "Disallows eval() and new Function()", tags: ["security"], framework: "global" },
  { id: "svelte-5-doctor/no-secrets-in-client-code", category: "Security", severity: "warn", description: "Detects hardcoded secrets in client components", tags: ["security"], framework: "global" },
  { id: "svelte-5-doctor/dom-clobbering-risk", category: "Security", severity: "error", description: "Detects DOM clobbering via attribute spreading on form inputs (CVE-2026-42573)", tags: ["security"], framework: "svelte5" },
  { id: "svelte-5-doctor/iframe-missing-sandbox", category: "Security", severity: "warn", description: "Requires sandbox on iframes", tags: ["security","a11y"], framework: "global" },

  // ── Correctness: Rune misuse (core Svelte 5 differentiator) ──
  { id: "svelte-5-doctor/legacy-export-let", category: "Correctness", severity: "error", description: "export let is invalid in runes mode — use $props()", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-5-doctor/legacy-dollars-colon", category: "Correctness", severity: "error", description: "$: reactive statement is invalid in runes mode — use $derived/$effect", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-5-doctor/legacy-event-directive", category: "Correctness", severity: "warn", description: "on:click directive is deprecated in Svelte 5 — use onclick attribute", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-5-doctor/legacy-slot", category: "Correctness", severity: "warn", description: "<slot> is deprecated — use {#snippet} + {@render}", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-5-doctor/rune-invalid-placement", category: "Correctness", severity: "error", description: "$state/$derived/$effect outside valid placement", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/state-invalid-export", category: "Correctness", severity: "error", description: "Exporting reassigned $state from .svelte.ts leaks SSR globals", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/props-invalid-placement", category: "Correctness", severity: "error", description: "$props() must be top-level destructuring", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/bindable-invalid-location", category: "Correctness", severity: "error", description: "$bindable() only inside $props() destructuring", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/derived-invalid-export", category: "Correctness", severity: "error", description: "Exporting $derived from module is invalid", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/store-rune-conflict", category: "Correctness", severity: "error", description: "$ prefix ambiguity between store and rune — rename local or store subscription", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/non-reactive-update", category: "Correctness", severity: "warn", description: "let reassigned but not $state — won't trigger updates", tags: ["correctness","performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/state-referenced-locally", category: "Correctness", severity: "error", description: "setContext('key', state) loses reactivity — wrap in getter () => state or object {get value(){return state}}", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/mixed-event-syntax", category: "Correctness", severity: "error", description: "Mixing on:click and onclick in same component", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/slot-snippet-conflict", category: "Correctness", severity: "error", description: "Mixing <slot> and {@render} in same file", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/each-item-mutation", category: "Correctness", severity: "error", description: "Direct mutation of {#each} item without index", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/snippet-invalid-rest", category: "Correctness", severity: "error", description: "Snippet with rest parameters is invalid", tags: ["correctness"], framework: "svelte5" },

  // ── Correctness: Effects & Derived (ported from you-might-not-need-an-effect) ──
  { id: "svelte-5-doctor/no-effect-derived", category: "Correctness", severity: "error", description: "Deriving state inside $effect — use $derived instead", tags: ["correctness","performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-effect-chain", category: "Correctness", severity: "warn", description: "Chained $effect syncing state — use $derived or event handler", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-deriving-props-in-effect", category: "Correctness", severity: "warn", description: "Deriving props inside $effect — use $derived", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-reset-on-prop", category: "Correctness", severity: "warn", description: "Resetting multiple $state on prop change — use {#key}", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/effect-needs-cleanup", category: "Correctness", severity: "error", description: "setInterval/addEventListener in $effect without cleanup", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-mutate-in-derived", category: "Correctness", severity: "error", description: "Mutating state inside $derived (forbidden)", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-init-state-in-effect", category: "Correctness", severity: "warn", description: "Initializing $state inside $effect — init at declaration", tags: ["correctness"], framework: "svelte5" },

  // ── Performance (ported from react-doctor/performance + js-*) ──
  { id: "svelte-5-doctor/no-derived-simple", category: "Performance", severity: "warn", description: "Useless $derived wrapping trivial expression", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-index-as-key", category: "Performance", severity: "warn", description: "{#each} without key or using index as key", tags: ["performance","correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/perf-avoid-deep-proxy", category: "Performance", severity: "warn", description: "Large object with $state — consider $state.raw", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/perf-avoid-inline-class", category: "Performance", severity: "warn", description: "new class inside component/effect — hoist", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/perf-avoid-nested-class", category: "Performance", severity: "warn", description: "Nested class declarations degrade perf", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-layout-animation", category: "Performance", severity: "error", description: "Animating layout properties (width/height/top) causes thrash", tags: ["performance"], framework: "global" },
  { id: "svelte-5-doctor/no-transition-all", category: "Performance", severity: "warn", description: "transition:all is expensive — specify property", tags: ["performance"], framework: "global" },
  { id: "svelte-5-doctor/no-large-animated-blur", category: "Performance", severity: "warn", description: "Large blur radius animation is expensive", tags: ["performance"], framework: "global" },
  { id: "svelte-5-doctor/js-combine-iterations", category: "Performance", severity: "warn", description: "Multiple iterations over same array — combine", tags: ["performance"], framework: "global" },
  { id: "svelte-5-doctor/js-hoist-regexp", category: "Performance", severity: "warn", description: "RegExp literal inside loop — hoist", tags: ["performance"], framework: "global" },
  { id: "svelte-5-doctor/js-hoist-intl", category: "Performance", severity: "warn", description: "Intl.* constructor inside loop — hoist", tags: ["performance"], framework: "global" },
  { id: "svelte-5-doctor/no-barrel-import", category: "Performance", severity: "warn", description: "Barrel import hurts tree-shaking", tags: ["performance","bundle-size"], framework: "global" },

  // ── Maintainability / Architecture (ported from deslop-js + no-giant-component) ──
  { id: "svelte-5-doctor/no-giant-component", category: "Maintainability", severity: "warn", description: "Component >400 lines — split via snippets/composition", tags: ["maintainability","architecture"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-nested-snippet", category: "Maintainability", severity: "warn", description: "Snippet defined inside markup recreates each render", tags: ["maintainability"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-inline-snippet", category: "Maintainability", severity: "warn", description: "Inline snippet creation — extract to top-level", tags: ["maintainability"], framework: "svelte5" },
  { id: "svelte-5-doctor/no-circular-import", category: "Maintainability", severity: "error", description: "Circular import detected", tags: ["maintainability","architecture"], framework: "global" },
  { id: "svelte-5-doctor/css-unused-selector", category: "Maintainability", severity: "warn", description: "Unused CSS selector in <style>", tags: ["maintainability"], framework: "svelte5" },

  // ── Accessibility (bridges svelte compiler a11y warnings) ──
  { id: "svelte-5-doctor/a11y-missing-attribute", category: "Accessibility", severity: "warn", description: "a11y: missing required attribute (img alt, a href)", tags: ["a11y"], framework: "svelte5" },
  { id: "svelte-5-doctor/a11y-click-events-have-key-events", category: "Accessibility", severity: "warn", description: "click handler without key handler", tags: ["a11y"], framework: "global" },
  { id: "svelte-5-doctor/a11y-no-static-element-interactions", category: "Accessibility", severity: "warn", description: "Interactive handler on static element without role", tags: ["a11y"], framework: "global" },

  // ── Perfection 2026-08-27 — 21 high-priority + 5 Kit (Svelte 5.56.10) ──
  { id: "svelte-5-doctor/effect-no-derived-computation", category: "Correctness", severity: "error", description: "$effect that only writes to single $state without side effect — use $derived instead", tags: ["correctness","performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/effect-async-tracking-loss", category: "Correctness", severity: "error", description: "State read after await/setTimeout inside $effect/$derived is not tracked — add void dep or untrack", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/effect-require-untrack-for-self-write", category: "Correctness", severity: "error", description: "Effect reads and writes same signal without untrack — wrap read with untrack() or use $derived", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/state-destructure-loss", category: "Correctness", severity: "warn", description: "Destructuring $state loses reactivity — use $derived or access via base", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/props-derived-required", category: "Correctness", severity: "warn", description: "Prop-derived plain assignment should be $derived — prop may change", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/props-fallback-no-mutate", category: "Correctness", severity: "warn", description: "Mutating fallback prop is not proxied — reassign or make bindable", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/bindable-mutation-without-bindable", category: "Correctness", severity: "error", description: "Mutating prop without $bindable triggers ownership_invalid_mutation — mark $bindable or use callback", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/raw-mutation-noop", category: "Correctness", severity: "error", description: "Mutating $state.raw is no-op — reassign instead (arr=[...arr])", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/snapshot-required", category: "Correctness", severity: "warn", description: "Passing reactive proxy to external lib — use $state.snapshot()", tags: ["correctness","performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/class-state-private-enumerability", category: "Correctness", severity: "warn", description: "Class with $state fields hidden from Object.keys/JSON — add toJSON()", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/derived-writable-version-gate", category: "Correctness", severity: "warn", description: "Derived reassignment needs svelte@5.25+ — version gate", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-5-doctor/effect-placement", category: "Correctness", severity: "error", description: "$effect used as value — effect_invalid_placement, must be expression statement", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/props-invalid", category: "Correctness", severity: "error", description: "Invalid $props/$bindable placement — props_invalid_* / bindable_invalid_location", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/rune-requires-parens", category: "Correctness", severity: "error", description: "Rune used without parentheses — rune_missing_parentheses", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/each-item-assignment", category: "Correctness", severity: "error", description: "Mutating each item directly — each_item_invalid_assignment, use array[i]", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/experimental-async", category: "Correctness", severity: "error", description: "await in $derived/template without experimental.async:true", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/attribute-sequence", category: "Correctness", severity: "error", description: "Comma sequence in attribute — attribute_invalid_sequence_expression", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/kit-remote-boundary-required", category: "Correctness", severity: "error", description: "await query() without <svelte:boundary> pending snippet — SSR crash", tags: ["correctness","sveltekit"], framework: "sveltekit" },
  { id: "svelte-5-doctor/kit-remote-run-removed", category: "Correctness", severity: "error", description: ".run() on remote query removed in 2.61 — use await query()", tags: ["correctness","sveltekit"], framework: "sveltekit" },
  { id: "svelte-5-doctor/kit-requested-limit", category: "Correctness", severity: "error", description: "requested() without limit or wrong shape — breaking 2.58", tags: ["correctness","sveltekit"], framework: "sveltekit" },
  { id: "svelte-5-doctor/kit-app-state-eager-init", category: "Performance", severity: "warn", description: "$app/state read at module top-level — eager leak in 2.70.3, move inside effect", tags: ["performance","sveltekit"], framework: "sveltekit" },
  { id: "svelte-5-doctor/kit-prefer-context-over-module-state", category: "Maintainability", severity: "warn", description: "Module-level $state in $lib vs createContext — SSR leak, prefer createContext", tags: ["maintainability","sveltekit"], framework: "sveltekit" },
  { id: "svelte-5-doctor/deslop-unused-file", category: "Maintainability", severity: "warn", description: "Svelte file never imported — dead code (port of deslop-js)", tags: ["maintainability","deslop"], framework: "svelte5" },
  { id: "svelte-5-doctor/supply-chain-outdated-svelte", category: "Security", severity: "warn", description: "Outdated svelte <5.56.10 — supply-chain risk, update", tags: ["security","supply-chain"], framework: "svelte5" },

  // ── 0.5.0 Brutally Needed (12) — SvelteKit 2/3 aware, no bloat ──
  { id: "svelte-5-doctor/rune-outside-svelte", category: "Correctness", severity: "error", description: "Rune ($state/$derived/$effect/$props/$bindable) outside .svelte/.svelte.js/.svelte.ts — silent no-op, rename file", tags: ["correctness","rune"], framework: "svelte5" },
  { id: "svelte-5-doctor/state-proxy-equality-mismatch", category: "Correctness", severity: "error", description: "Comparing proxy (from $state) with raw object via === always false — use $state.snapshot", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/await-waterfall", category: "Performance", severity: "warn", description: "Sequential await where Promise.all would halve latency — Svelte 5.55+ runtime warning await_waterfall", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/assignment-value-stale", category: "Correctness", severity: "error", description: "(arr ??= []).push(arr.length) discards push — split to arr ??= []; arr.push(...)", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/console-log-state", category: "Correctness", severity: "warn", description: "console.log of $state proxy logs Proxy{} not value — use $state.snapshot or $inspect", tags: ["correctness","dx"], framework: "svelte5" },
  { id: "svelte-5-doctor/derived-inert", category: "Correctness", severity: "error", description: "$derived inside $effect becomes inert after teardown — hoist derived outside effect", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/each-key-volatile", category: "Correctness", severity: "error", description: "Each key is new array/object literal each tick — volatile, thrashes DOM. Use stable string/number", tags: ["correctness","performance"], framework: "svelte5" },
  { id: "svelte-5-doctor/module-shared-state-ssr-leak", category: "Security", severity: "error", description: "Top-level $state in src/lib/*.svelte.ts leaks across SSR requests — use createContext or $lib/server", tags: ["security","ssr"], framework: "svelte5" },
  { id: "svelte-5-doctor/store-subscription-outside-svelte", category: "Correctness", severity: "error", description: "$store subscription only works inside .svelte — use get(store) in .svelte.ts", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-5-doctor/hydration-risk", category: "Correctness", severity: "warn", description: "Invalid HTML that browser repairs (<p><div>, table without tbody) causes hydration_mismatch", tags: ["correctness","ssr"], framework: "svelte5" },
  { id: "svelte-5-doctor/remote-await-boundary", category: "Correctness", severity: "error", description: "await query() outside <svelte:boundary pending> renders pending on server (remoteFunctions)", tags: ["correctness","sveltekit"], framework: "sveltekit" },
  { id: "svelte-5-doctor/props-id-placement", category: "Correctness", severity: "error", description: "$props.id() only at top-level variable initializer — inside if/effect causes hydration mismatch", tags: ["correctness"], framework: "svelte5" },
];

export const RULE_IDS = new Set(SVELTE_DOCTOR_RULES.map((r) => r.id));
export const RULES_BY_CATEGORY = SVELTE_DOCTOR_RULES.reduce<Record<string, typeof SVELTE_DOCTOR_RULES>>((acc, rule) => {
  (acc[rule.category] ??= []).push(rule);
  return acc;
}, {});
export const RULE_MAP = new Map(SVELTE_DOCTOR_RULES.map((r) => [r.id, r] as const));
// Backward compat: svelte-doctor/* alias for svelte-5-doctor/*
for (const rule of SVELTE_DOCTOR_RULES) {
  if (rule.id.startsWith("svelte-5-doctor/")) {
    const alias = rule.id.replace("svelte-5-doctor/", "svelte-doctor/");
    if (!RULE_MAP.has(alias)) RULE_MAP.set(alias, rule);
  }
}
