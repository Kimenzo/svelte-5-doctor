#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
const reportFile = process.argv[2];
const scanStatus = Number(process.argv[3] ?? "0");
if (!reportFile || !existsSync(reportFile)) {
  console.error(`Report not found: ${reportFile}`);
  process.exit(1);
}
try {
  const raw = readFileSync(reportFile, "utf-8");
  const json = JSON.parse(raw);
  if (typeof json.score !== "number" || !Array.isArray(json.diagnostics)) throw new Error("Invalid report shape");
  process.exit(0);
} catch (err) {
  console.error(`Invalid JSON report: ${err.message}`);
  process.exit(1);
}
