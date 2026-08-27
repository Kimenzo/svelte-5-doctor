<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/svelte-5-doctor-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/svelte-5-doctor-logo-light.svg">
  <img alt="Svelte Doctor" src="./assets/svelte-5-doctor-logo-light.svg" width="140" height="36">
</picture>

[![version](https://img.shields.io/npm/v/svelte-5-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/svelte-5-doctor)
[![downloads](https://img.shields.io/npm/dt/svelte-5-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/svelte-5-doctor)
[![license](https://img.shields.io/badge/license-Modified%20MIT-blue?style=flat&colorA=000000&colorB=000000)](#license)

Your agent writes bad Svelte 5, this catches it.

**Svelte Doctor** is a deterministic 0-100 health check for Svelte 5 codebases — ported from [React Doctor](https://github.com/millionco/react-doctor) (design source of truth). It scans `.svelte`, `.svelte.js`, `.svelte.ts`, `.js` and `.ts` files via [`svelte/compiler`](https://svelte.dev/docs/svelte/svelte-compiler) and 52 purpose-built rules.

> **Design source:** [`react-doctor-source/`](../react-doctor-source) — cloned from `millionco/react-doctor`. Every CLI flag, category and scoring band mirrors React Doctor; only the AST engine changed (oxlint → `svelte/compiler`).

Works across Svelte 5 + SvelteKit — Vite, SvelteKit 2, Astro Svelte, you name it.

[Docs →](https://github.com/Kimenzo/svelte-5-doctor#readme) · [Rules →](#rules) · [CI →](#3-run-in-ci)

## Install

### 1. Quick start

```bash
npx svelte-5-doctor@latest .
# or via pnpm
pnpm dlx svelte-5-doctor@latest .
```

Verbose, diff-aware (like `react-doctor --verbose --diff`):

```bash
npx -y svelte-5-doctor@latest . --verbose --scope changed --base main
```

JSON for agents (mirrors `react-doctor --json`):

```bash
npx svelte-5-doctor --json --json-out ./report.json
npx svelte-5-doctor --category Security --json
npx svelte-5-doctor --score   # numeric only
```

### 2. Install for agents

```bash
npx svelte-5-doctor@latest install
# or agent-specific
npx svelte-5-doctor@latest install --agent claude --dry-run
```

Works with Claude Code, Cursor, Codex, OpenCode, Windsurf (same as `react-doctor install`).

### 3. Run in CI

Svelte Doctor reviews every PR and reports **only issues your change introduced**:

```bash
npx svelte-5-doctor@latest ci install
# interactive: detects GitHub Actions, writes .github/workflows/svelte-5-doctor.yml
```

Or use the GitHub Action directly (ported from `action.yml`):

```yaml
uses: Kimenzo/svelte-5-doctor@v1
with:
  scope: changed   # changed | files | full
  blocking: none   # none | warning | error
  comment: true
  review-comments: true
  commit-status: true
```

### 4. Configure rules

```ts
// svelte-5-doctor.config.ts — mirrors doctor.config.ts
export default {
  rules: {
    "svelte-5-doctor/no-at-html-xss": "error",
    "svelte-5-doctor/legacy-export-let": "error",
    "svelte-5-doctor/no-effect-derived": "warn",
  },
  categories: { Performance: "warn" },
  ignore: ["src/legacy/**"],
};
```

## What it checks — 52 rules across 5 categories

| Category | Example Rules | Ported From |
|----------|---------------|-------------|
| **Security** | `no-at-html-xss` ({@html} XSS → React's dangerouslySetInnerHTML), `dom-clobbering-risk` (CVE-2026-42573), `no-eval`, `iframe-missing-sandbox` | `react-doctor/security` |
| **Correctness** | `legacy-export-let`, `legacy-dollars-colon` ($: → $derived), `legacy-event-directive` (on:click → onclick), `rune-invalid-placement`, `state-invalid-export`, `effect-needs-cleanup`, `no-effect-derived` (8 ported from `you-might-not-need-an-effect`) | `react-doctor/state-and-effects` + `compiler-errors` |
| **Performance** | `no-index-as-key` ({#each} key), `perf-avoid-deep-proxy` ($state.raw), `no-layout-animation`, `js-combine-iterations`, `no-barrel-import` | `react-doctor/performance` + `js-*` |
| **Accessibility** | `a11y-missing-attribute`, `a11y-click-events-have-key-events` (bridges `svelte/compiler` a11y warnings) | `react-doctor/a11y` + 30+ `svelte:a11y_*` warnings |
| **Maintainability** | `no-giant-component` (>400 lines), `css-unused-selector`, dead-code via `deslop` | `react-doctor/maintainability` |

Full list:

```bash
npx svelte-5-doctor rules list
npx svelte-5-doctor rules list --category Security --json
npx svelte-5-doctor rules explain svelte-5-doctor/no-at-html-xss
```

## Svelte 5 coverage

Svelte Doctor understands Svelte 5 runes thoroughly (verified via exhaustive web search of `svelte.dev/docs`):

- **Runes:** `$state`, `$state.raw`, `$state.snapshot`, `$derived`, `$derived.by`, `$effect`, `$effect.pre`, `$props`, `$bindable`, `$inspect`, `$host`, `$props.id()` — placement, SSR leaks, store conflicts all checked.
- **Snippets vs slots:** `{#snippet}` + `{@render}` vs deprecated `<slot>`; detects mixing.
- **Events:** `onclick` vs `on:click`, modifier de-migration, delegated event perf.
- **Files:** `.svelte` vs `.svelte.js/.svelte.ts` shared state modules — SSR global-leak detection.
- **Lifecycle:** `beforeUpdate/afterUpdate` → `$effect.pre/$effect` + `tick()` guidance.

See [`docs/svelte-5-porting-map.md`](./docs/svelte-5-porting-map.md) for the full React → Svelte rule translation table (287 → 52 first wave).

## Scoring

Deterministic 0-100, same as React Doctor:

- `15` points per `error`, `5` per `warn`
- Bands: `≥75 Great`, `50–74 Needs work`, `<50 Critical`
- Exit code `1` when diagnostics match `--blocking` level (default: `error`).

## Monorepo layout — mirrors React Doctor

```
svelte-5-doctor/               # ← this repo
├── packages/
│   ├── core/               # @svelte-5-doctor/core — runInspect pipeline (svelte/compiler) — ported from @react-doctor/core
│   ├── svelte-5-doctor/      # CLI (svelte-5-doctor) — ported from packages/react-doctor
│   ├── svelte-plugin-svelte-5-doctor/  # 52 rules — ported from oxlint-plugin-react-doctor (287 rules)
│   └── eslint-plugin-svelte-5-doctor/  # flat-config wrapper — ported from eslint-plugin-react-doctor
├── examples/kitchen-sink/  # intentionally buggy Svelte 5 fixture (score: ~20)
├── docs/                   # HOW_TO_WRITE_A_RULE.md, svelte-5-porting-map.md
└── action.yml              # GitHub Action v1 — ported from React Doctor action.yml
```

Design source of truth lives in [`react-doctor-source/`](./react-doctor-source) (cloned `millionco/react-doctor`). The port keeps:

- `AGENTS.md` conventions (kebab-case, arrow functions, truffler dedup, no `as` casts)
- Effect-free MVP; Effect v4 upgrade path matches `react-doctor-source/AGENTS.md`
- Identical JSON schema `schemaVersion: 3` + `0-100` scoring

## Why this port?

React Doctor is the most thorough React linter (oxlint + Rust, 287 rules, whole-project graph). Svelte 5's runes rewrite introduced *new* correctness classes (rune placement, SSR leak, snippet conflicts) with **no equivalent doctor tool**. This port reuses React Doctor's proven UX (score, diff scope, agent install, CI comment) while swapping the AST engine to `svelte/compiler` — the only parser that understands Svelte 5 template semantics.

## Telemetry

Same as React Doctor (Sentry + Axiom): crashes + anonymous wide event (`score`, `category counts`, `framework`, no file contents). Opt-out with `--no-telemetry`.

## Contributing

Issues welcome! See [`docs/HOW_TO_WRITE_A_RULE.md`](./docs/HOW_TO_WRITE_A_RULE.md) — same `defineRule({ id, category, create })` + `pnpm gen` workflow as React Doctor.

## License

Modified MIT — same as React Doctor. See [LICENSE](./LICENSE).

> Port by [Kimenzo](https://github.com/Kimenzo) · Original by [Million Software Inc.](https://github.com/millionco/react-doctor)
