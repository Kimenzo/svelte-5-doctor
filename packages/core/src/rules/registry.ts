/**
 * Rule Registry — ported from react-doctor-source/packages/oxlint-plugin-react-doctor/src/plugin/rule-registry.ts
 * Generated via `pnpm gen` in React Doctor; here we hand-author Svelte 5 equivalents.
 * 287 React rules → 52 Svelte Doctor rules (first wave). Categories + severity mirrored.
 */
import type { RuleMeta } from "../types.js";

export const SVELTE_DOCTOR_RULES: RuleMeta[] = [
  // ── Security (mirrors react-doctor/security + no-eval, no-secrets) ──
  { id: "svelte-doctor/no-at-html-xss", category: "Security", severity: "error", description: "Disallows unsanitized {@html} — use DOMPurify or TrustedHTML", tags: ["security","xss"], framework: "svelte5" },
  { id: "svelte-doctor/no-eval", category: "Security", severity: "error", description: "Disallows eval() and new Function()", tags: ["security"], framework: "global" },
  { id: "svelte-doctor/no-secrets-in-client-code", category: "Security", severity: "warn", description: "Detects hardcoded secrets in client components", tags: ["security"], framework: "global" },
  { id: "svelte-doctor/dom-clobbering-risk", category: "Security", severity: "error", description: "Detects DOM clobbering via attribute spreading on form inputs (CVE-2026-42573)", tags: ["security"], framework: "svelte5" },
  { id: "svelte-doctor/iframe-missing-sandbox", category: "Security", severity: "warn", description: "Requires sandbox on iframes", tags: ["security","a11y"], framework: "global" },

  // ── Correctness: Rune misuse (core Svelte 5 differentiator) ──
  { id: "svelte-doctor/legacy-export-let", category: "Correctness", severity: "error", description: "export let is invalid in runes mode — use $props()", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-doctor/legacy-dollars-colon", category: "Correctness", severity: "error", description: "$: reactive statement is invalid in runes mode — use $derived/$effect", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-doctor/legacy-event-directive", category: "Correctness", severity: "warn", description: "on:click directive is deprecated in Svelte 5 — use onclick attribute", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-doctor/legacy-slot", category: "Correctness", severity: "warn", description: "<slot> is deprecated — use {#snippet} + {@render}", tags: ["correctness","migration"], framework: "svelte5" },
  { id: "svelte-doctor/rune-invalid-placement", category: "Correctness", severity: "error", description: "$state/$derived/$effect outside valid placement", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/state-invalid-export", category: "Correctness", severity: "error", description: "Exporting reassigned $state from .svelte.ts leaks SSR globals", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/props-invalid-placement", category: "Correctness", severity: "error", description: "$props() must be top-level destructuring", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/bindable-invalid-location", category: "Correctness", severity: "error", description: "$bindable() only inside $props() destructuring", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/derived-invalid-export", category: "Correctness", severity: "error", description: "Exporting $derived from module is invalid", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/store-rune-conflict", category: "Correctness", severity: "warn", description: "$ prefix ambiguity between store and rune", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/non-reactive-update", category: "Correctness", severity: "warn", description: "let reassigned but not $state — won't trigger updates", tags: ["correctness","performance"], framework: "svelte5" },
  { id: "svelte-doctor/state-referenced-locally", category: "Correctness", severity: "warn", description: "setContext('key', state) loses reactivity — wrap in getter", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/mixed-event-syntax", category: "Correctness", severity: "error", description: "Mixing on:click and onclick in same component", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/slot-snippet-conflict", category: "Correctness", severity: "error", description: "Mixing <slot> and {@render} in same file", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/each-item-mutation", category: "Correctness", severity: "error", description: "Direct mutation of {#each} item without index", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/snippet-invalid-rest", category: "Correctness", severity: "error", description: "Snippet with rest parameters is invalid", tags: ["correctness"], framework: "svelte5" },

  // ── Correctness: Effects & Derived (ported from you-might-not-need-an-effect) ──
  { id: "svelte-doctor/no-effect-derived", category: "Correctness", severity: "error", description: "Deriving state inside $effect — use $derived instead", tags: ["correctness","performance"], framework: "svelte5" },
  { id: "svelte-doctor/no-effect-chain", category: "Correctness", severity: "warn", description: "Chained $effect syncing state — use $derived or event handler", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/no-deriving-props-in-effect", category: "Correctness", severity: "warn", description: "Deriving props inside $effect — use $derived", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/no-reset-on-prop", category: "Correctness", severity: "warn", description: "Resetting multiple $state on prop change — use {#key}", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/effect-needs-cleanup", category: "Correctness", severity: "error", description: "setInterval/addEventListener in $effect without cleanup", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/no-mutate-in-derived", category: "Correctness", severity: "error", description: "Mutating state inside $derived (forbidden)", tags: ["correctness"], framework: "svelte5" },
  { id: "svelte-doctor/no-init-state-in-effect", category: "Correctness", severity: "warn", description: "Initializing $state inside $effect — init at declaration", tags: ["correctness"], framework: "svelte5" },

  // ── Performance (ported from react-doctor/performance + js-*) ──
  { id: "svelte-doctor/no-derived-simple", category: "Performance", severity: "warn", description: "Useless $derived wrapping trivial expression", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-doctor/no-index-as-key", category: "Performance", severity: "warn", description: "{#each} without key or using index as key", tags: ["performance","correctness"], framework: "svelte5" },
  { id: "svelte-doctor/perf-avoid-deep-proxy", category: "Performance", severity: "warn", description: "Large object with $state — consider $state.raw", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-doctor/perf-avoid-inline-class", category: "Performance", severity: "warn", description: "new class inside component/effect — hoist", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-doctor/perf-avoid-nested-class", category: "Performance", severity: "warn", description: "Nested class declarations degrade perf", tags: ["performance"], framework: "svelte5" },
  { id: "svelte-doctor/no-layout-animation", category: "Performance", severity: "error", description: "Animating layout properties (width/height/top) causes thrash", tags: ["performance"], framework: "global" },
  { id: "svelte-doctor/no-transition-all", category: "Performance", severity: "warn", description: "transition:all is expensive — specify property", tags: ["performance"], framework: "global" },
  { id: "svelte-doctor/no-large-animated-blur", category: "Performance", severity: "warn", description: "Large blur radius animation is expensive", tags: ["performance"], framework: "global" },
  { id: "svelte-doctor/js-combine-iterations", category: "Performance", severity: "warn", description: "Multiple iterations over same array — combine", tags: ["performance"], framework: "global" },
  { id: "svelte-doctor/js-hoist-regexp", category: "Performance", severity: "warn", description: "RegExp literal inside loop — hoist", tags: ["performance"], framework: "global" },
  { id: "svelte-doctor/js-hoist-intl", category: "Performance", severity: "warn", description: "Intl.* constructor inside loop — hoist", tags: ["performance"], framework: "global" },
  { id: "svelte-doctor/no-barrel-import", category: "Performance", severity: "warn", description: "Barrel import hurts tree-shaking", tags: ["performance","bundle-size"], framework: "global" },

  // ── Maintainability / Architecture (ported from deslop-js + no-giant-component) ──
  { id: "svelte-doctor/no-giant-component", category: "Maintainability", severity: "warn", description: "Component >400 lines — split via snippets/composition", tags: ["maintainability","architecture"], framework: "svelte5" },
  { id: "svelte-doctor/no-nested-snippet", category: "Maintainability", severity: "warn", description: "Snippet defined inside markup recreates each render", tags: ["maintainability"], framework: "svelte5" },
  { id: "svelte-doctor/no-inline-snippet", category: "Maintainability", severity: "warn", description: "Inline snippet creation — extract to top-level", tags: ["maintainability"], framework: "svelte5" },
  { id: "svelte-doctor/no-circular-import", category: "Maintainability", severity: "error", description: "Circular import detected", tags: ["maintainability","architecture"], framework: "global" },
  { id: "svelte-doctor/css-unused-selector", category: "Maintainability", severity: "warn", description: "Unused CSS selector in <style>", tags: ["maintainability"], framework: "svelte5" },

  // ── Accessibility (bridges svelte compiler a11y warnings) ──
  { id: "svelte-doctor/a11y-missing-attribute", category: "Accessibility", severity: "warn", description: "a11y: missing required attribute (img alt, a href)", tags: ["a11y"], framework: "svelte5" },
  { id: "svelte-doctor/a11y-click-events-have-key-events", category: "Accessibility", severity: "warn", description: "click handler without key handler", tags: ["a11y"], framework: "global" },
  { id: "svelte-doctor/a11y-no-static-element-interactions", category: "Accessibility", severity: "warn", description: "Interactive handler on static element without role", tags: ["a11y"], framework: "global" },
];

export const RULE_IDS = new Set(SVELTE_DOCTOR_RULES.map((r) => r.id));
export const RULES_BY_CATEGORY = SVELTE_DOCTOR_RULES.reduce<Record<string, typeof SVELTE_DOCTOR_RULES>>((acc, rule) => {
  (acc[rule.category] ??= []).push(rule);
  return acc;
}, {});
export const RULE_MAP = new Map(SVELTE_DOCTOR_RULES.map((r) => [r.id, r] as const));
