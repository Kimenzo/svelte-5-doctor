#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const reportFile = process.argv[2];
const commentFile = process.argv[3];
if (!reportFile || !commentFile) process.exit(0);
if (!existsSync(reportFile)) process.exit(0);
let report;
try { report = JSON.parse(readFileSync(reportFile, "utf-8")); } catch { process.exit(0); }
const marker = "<!-- svelte-doctor:summary -->";
const score = report.score ?? "?";
const label = report.label ?? "Unknown";
const summary = report.summary ?? { total: 0, errors: 0, warnings: 0 };
const diagnostics = report.diagnostics ?? [];
const headSha = process.env.SVELTE_DOCTOR_HEAD_SHA ?? process.env.REACT_DOCTOR_HEAD_SHA ?? "";
const runUrl = process.env.GITHUB_RUN_URL ?? "";
const skipped = diagnostics.length === 0 && summary.total === 0 && report.skippedCheckReasons?.length === 0 ? false : false;

let body = `${marker}\n## Svelte Doctor — Score: ${score}/100 (${label})\n\n`;
body += `**${summary.total} findings** — ${summary.errors} errors, ${summary.warnings} warnings\n\n`;
if (diagnostics.length === 0) {
  body += `✅ No issues found.\n`;
} else {
  const byCat = {};
  for (const d of diagnostics) (byCat[d.category] ??= []).push(d);
  for (const [cat, list] of Object.entries(byCat)) {
    body += `### ${cat} — ${list.length}\n`;
    for (const d of list.slice(0, 10)) {
      body += `- \`${d.severity}\` **${d.ruleId}** — ${d.message}  \n  \`${d.filePath}:${d.line}:${d.column}\`\n`;
    }
    if (list.length > 10) body += `  _and ${list.length - 10} more_\n`;
    body += `\n`;
  }
}
if (headSha) body += `\n_Scanned: ${headSha.slice(0, 7)}_`;
if (runUrl) body += ` — [View run](${runUrl})`;
body += `\n`;

writeFileSync(commentFile, body, "utf-8");

// GitHub Action outputs for status
import { appendFileSync } from "node:fs";
const out = process.env.GITHUB_OUTPUT;
if (out) {
  appendFileSync(out, `score=${score}\n`);
  appendFileSync(out, `total-issues=${summary.total}\n`);
  appendFileSync(out, `error-count=${summary.errors}\n`);
  appendFileSync(out, `warning-count=${summary.warnings}\n`);
  appendFileSync(out, `affected-files=${summary.affectedFiles ?? 0}\n`);
  appendFileSync(out, `skipped=false\n`);
}
