#!/usr/bin/env node
/**
 * Svelte Doctor CLI — ported from react-doctor-source/packages/react-doctor/src/cli/index.ts
 * Mirrors React Doctor CLI surface: [directory] [options], --json, --verbose, --category, rules, why, ci
 */
import { Command } from "commander";
import pc from "picocolors";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInspect } from "svelte-5-doctor-core";
import { SVELTE_DOCTOR_RULES, RULE_MAP } from "svelte-5-doctor-core";
import { applyFixes } from "svelte-5-doctor-core/fix";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string; name: string };

const program = new Command();

program
  .name("svelte-5-doctor")
  .description("Svelte 5 Doctor — 0-100 health check for Svelte 5 codebases. Ported from React Doctor. (svelte-doctor alias kept for compat)")
  .version(pkg.version, "-v, --version", "output the version number")
  .argument("[directory]", "directory to scan", ".")
  .option("--json", "output JSON report")
  .option("--json-out <path>", "write JSON to file")
  .option("--verbose", "verbose diagnostics")
  .option("--category <category>", "filter by category (repeatable)", (v, prev: string[]) => [...prev, v], [])
  .option("--score", "output score only")
  .option("--no-score", "disable scoring output")
  .option("--diff", "alias for --scope changed (deprecated)", false)
  .option("--scope <scope>", "scope: full | changed | files", "full")
  .option("--base <branch>", "diff base for changed scope", "main")
  .option("--blocking <level>", "fail CI on: error | warning | none (also score <75)", "none")
  .option("--fail-on-score <n>", "fail if score < n (default 75 for --blocking error)", "75")
  .option("--fix", "auto-fix fixable diagnostics (like Bun 1.4 --fix / oxlint --fix) — Svelte 4 deprecation, unused CSS, a11y, rune parens")
  .option("--dry-run", "with --fix, show diff without writing (like --fix --dry-run)")
  .option("--no-color", "disable color")
  .action(async (directory: string, opts) => {
    const dir = resolve(process.cwd(), directory);
    const categories: string[] = opts.category ?? [];
    // deprecated --diff alias
    const scope = opts.diff ? "changed" : (opts.scope as "full" | "changed" | "files");

    const started = Date.now();
    let report = await runInspect({ directory: dir, categories: categories.length ? categories : undefined, scope });

    // Auto-fix — like Bun 1.4 --fix / oxlint --fix: apply fixable diagnostics and re-score
    if (opts.fix) {
      const { readFileSync, writeFileSync } = await import("node:fs");
      const byFile = new Map<string, typeof report.diagnostics>();
      for (const d of report.diagnostics) {
        if (!byFile.has(d.filePath)) byFile.set(d.filePath, []);
        byFile.get(d.filePath)!.push(d);
      }
      let totalApplied = 0;
      let totalSkipped = 0;
      let totalFiles = 0;
      for (const [rel, diags] of byFile) {
        const abs = resolve(dir, rel);
        try {
          const src = readFileSync(abs, "utf-8");
          const res = applyFixes(rel, src, diags);
          if (res.applied > 0) {
            totalApplied += res.applied;
            totalSkipped += res.skipped;
            totalFiles++;
            if (!(opts.dryRun as boolean)) writeFileSync(abs, res.fixed, "utf-8");
            console.log(pc.green(`${(opts.dryRun as boolean) ? "[dry-run] " : ""}Fixed ${res.applied} in ${rel}${res.skipped ? ` (${res.skipped} skipped)` : ""}`));
            if (opts.dryRun as boolean) {
              const origLines = res.original.split("\n");
              const fixedLines = res.fixed.split("\n");
              for (let i = 0; i < Math.min(origLines.length, fixedLines.length, 5); i++) {
                if (origLines[i] !== fixedLines[i]) {
                  console.log(pc.dim(`  ${i + 1}: - ${(origLines[i] ?? "").slice(0, 80)}`));
                  console.log(pc.green(`     + ${(fixedLines[i] ?? "").slice(0, 80)}`));
                }
              }
            }
          }
        } catch {}
      }
      console.log(pc.bold(`\n  Auto-fix: ${totalApplied} applied in ${totalFiles} files${(opts.dryRun as boolean) ? " (dry-run, no files written)" : ""}${totalSkipped ? `, ${totalSkipped} skipped` : ""}`));
      const newReport = await runInspect({ directory: dir, categories: categories.length ? categories : undefined, scope });
      console.log(pc.dim(`  Score: ${report.score} → ${newReport.score} (${newReport.label})`));
      report = newReport;
      if (totalApplied === 0) console.log(pc.yellow("  No fixable diagnostics found (fixable: Svelte 4 deprecation, unused CSS, a11y alt/href, rune parens)"));
    }

    if (opts.score && !opts.json) {
      console.log(String(report.score));
      process.exit(report.diagnostics.some((d) => d.severity === "error") ? 1 : 0);
    }

    if (opts.json) {
      const out = JSON.stringify(report, null, 2);
      if (opts.jsonOut) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(resolve(process.cwd(), opts.jsonOut), out, "utf-8");
        console.log(pc.green(`JSON written to ${opts.jsonOut}`));
      } else {
        console.log(out);
      }
      const blockingJson = (opts.blocking as string) ?? "none";
      const failOnScoreJson = Number.parseInt((opts.failOnScore as string) ?? "75", 10);
      const hasErrorsJson = report.diagnostics.some((d) => d.severity === "error");
      const hasWarningsJson = report.diagnostics.some((d) => d.severity === "warn");
      const scoreBlockedJson = report.score < failOnScoreJson && blockingJson !== "none";
      const shouldFailJson = (blockingJson === "error" && hasErrorsJson) || (blockingJson === "warning" && (hasErrorsJson || hasWarningsJson)) || scoreBlockedJson;
      process.exit(shouldFailJson ? 1 : 0);
    }

    // human output — mirrors react-doctor score header
    const labelColor =
      report.label === "Great" ? pc.green : report.label === "Needs work" ? pc.yellow : pc.red;
    console.log("");
    console.log(`  ${pc.bold("Svelte Doctor")}  ${pc.dim(`v${pkg.version}`)}  ${labelColor(`Score: ${report.score} (${report.label})`)}`);
    console.log(`  ${pc.dim(`${report.summary.total} findings — ${report.summary.errors} errors, ${report.summary.warnings} warnings — ${report.meta.durationMs}ms`)}`);
    console.log(`  ${pc.dim(`Svelte ${report.meta.svelteVersion} · ${report.meta.directory}`)}`);
    console.log("");

    if (report.diagnostics.length === 0) {
      console.log(pc.green("  ✓ No issues found. Your Svelte 5 codebase is healthy!"));
      console.log("");
      process.exit(0);
    }

    // group by category like react-doctor
    const byCat: Record<string, typeof report.diagnostics> = {};
    for (const d of report.diagnostics) (byCat[d.category] ??= []).push(d);
    const order = ["Security", "Correctness", "Performance", "Accessibility", "Maintainability", "Architecture"];
    const cats = order.filter((c) => byCat[c]?.length);

    for (const cat of cats) {
      const list = byCat[cat] ?? [];
      const icon = cat === "Security" ? "🔒" : cat === "Correctness" ? "🐛" : cat === "Performance" ? "⚡" : cat === "Accessibility" ? "♿" : "🏗️";
      console.log(`  ${icon} ${pc.bold(cat)} — ${list.length}`);
      for (const d of list.slice(0, opts.verbose ? 100 : 10)) {
        const sev = d.severity === "error" ? pc.red("error") : pc.yellow("warn");
        const loc = pc.dim(`${d.filePath}:${d.line}:${d.column}`);
        console.log(`    ${sev}  ${pc.bold(d.ruleId)}  ${d.message}`);
        console.log(`         ${loc}`);
        if (opts.verbose && d.fix) console.log(`         ${pc.cyan("fix:")} ${d.fix}`);
      }
      if (!opts.verbose && list.length > 10) console.log(pc.dim(`    ... and ${list.length - 10} more (use --verbose)`));
      console.log("");
    }

    if (report.skippedCheckReasons?.length) {
      console.log(pc.dim(`  skipped: ${report.skippedCheckReasons.length} checks`));
    }

    console.log(pc.dim(`  Run ${pc.bold("npx svelte-5-doctor --json --json-out report.json")} for machine-readable output.`));
    console.log(pc.dim(`  Run ${pc.bold("npx svelte-5-doctor rules list")} to see all rules.`));
    console.log("");

    // Score CI gate — ported from react-doctor blocking + SCORE_BANDS (75/50) — svelte-5-doctor 0.3.0 perfection
    const blocking = (opts.blocking as string) ?? "none";
    const failOnScore = Number.parseInt((opts.failOnScore as string) ?? "75", 10);
    const hasErrors = report.diagnostics.some((d) => d.severity === "error");
    const hasWarnings = report.diagnostics.some((d) => d.severity === "warn");
    const scoreBlocked = report.score < failOnScore && blocking !== "none";
    if (scoreBlocked) console.log(pc.yellow(`  Score ${report.score} < ${failOnScore} — failing due to --blocking ${blocking}`));
    const shouldFail = (blocking === "error" && hasErrors) || (blocking === "warning" && (hasErrors || hasWarnings)) || scoreBlocked;
    process.exit(shouldFail ? 1 : 0);
  });

program
  .command("rules")
  .description("list and explain rules (ported from react-doctor rules)")
  .argument("[subcommand]", "list | explain", "list")
  .argument("[ruleId]", "rule id for explain")
  .option("--category <cat>", "filter by category")
  .option("--json", "json output")
  .action((sub, ruleId, opts, cmd) => {
    const parentOpts = program.opts();
    // commander v14: subcommand args handling tricky; fallback
    const subCmd = sub ?? "list";
    const targetId = ruleId;

    if (subCmd === "explain" && targetId) {
      const rule = RULE_MAP.get(targetId) ?? RULE_MAP.get(`svelte-doctor/${targetId}`) ?? RULE_MAP.get(`svelte-5-doctor/${targetId}`);
      if (!rule) {
        console.error(pc.red(`Unknown rule: ${targetId}`));
        process.exit(1);
      }
      console.log(`${pc.bold(rule.id)} [${rule.category}] ${rule.severity}`);
      console.log(rule.description);
      if (rule.tags?.length) console.log(pc.dim(`tags: ${rule.tags.join(", ")}`));
      if (rule.fix) console.log(pc.cyan(`fix: ${rule.fix}`));
      return;
    }

    let rules = [...SVELTE_DOCTOR_RULES];
    if (opts.category) rules = rules.filter((r) => r.category.toLowerCase() === String(opts.category).toLowerCase());
    if (opts.json) {
      console.log(JSON.stringify(rules, null, 2));
      return;
    }
    console.log(pc.bold(`Svelte Doctor — ${rules.length} rules (ported from React Doctor's 287)`));
    console.log(pc.dim("Categories: Security · Correctness · Performance · Accessibility · Maintainability"));
    console.log("");
    for (const r of rules) {
      const sev = r.severity === "error" ? pc.red(r.severity) : r.severity === "warn" ? pc.yellow(r.severity) : pc.dim(r.severity);
      console.log(`  ${sev.padEnd(10)} ${pc.bold(r.id)}  ${pc.dim(`[${r.category}]`)}  ${r.description}`);
    }
    console.log("");
    console.log(pc.dim(`Run ${pc.bold("npx svelte-5-doctor rules explain <ruleId>")} for details.`));
  });

program
  .command("why")
  .description("explain why a diagnostic was reported at a location")
  .argument("<location>", "file:line e.g. src/App.svelte:42")
  .action(async (location: string) => {
    const [file, lineStr] = location.split(":");
    const line = Number.parseInt(lineStr ?? "1", 10);
    const dir = process.cwd();
    const report = await runInspect({ directory: dir });
    const matches = report.diagnostics.filter((d) => d.filePath.endsWith(file ?? "") && Math.abs(d.line - line) <= 2);
    if (!matches.length) {
      console.log(pc.yellow(`No diagnostics near ${location}`));
      return;
    }
    for (const d of matches) {
      console.log(`${pc.bold(d.ruleId)} [${d.category}] ${d.severity} at ${d.filePath}:${d.line}:${d.column}`);
      console.log(`  ${d.message}`);
      if (d.fix) console.log(pc.cyan(`  fix: ${d.fix}`));
      const rule = RULE_MAP.get(d.ruleId);
      if (rule) console.log(pc.dim(`  ${rule.description}`));
      console.log("");
    }
  });

program
  .command("ci")
  .description("CI helpers (ported from react-doctor ci)")
  .argument("[sub]", "install | config")
  .action((sub) => {
    if (sub === "install" || !sub) {
      console.log(pc.bold("Svelte Doctor CI install"));
      console.log("");
      console.log("Add to .github/workflows/svelte-doctor.yml:");
      console.log(pc.cyan(`
name: Svelte Doctor
on:
  pull_request: [opened, synchronize, reopened]
  push:
    branches: [main]
jobs:
  svelte-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: npx svelte-doctor --scope changed --base main
`));
      console.log(pc.dim("See action.yml for full GitHub Action inputs (blocking, scope, comment)."));
      return;
    }
    console.log("Unknown ci subcommand:", sub);
  });

program.parseAsync(process.argv);
