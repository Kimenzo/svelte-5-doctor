#!/usr/bin/env node
// Ported from react-doctor-source/scripts/resolve-package-spec.mjs
// Resolves version input to spec + cacheability for action toolchain caching.
import { writeFileSync } from "node:fs";
const input = process.argv[2] ?? "latest";
let spec = "svelte-doctor@latest";
let resolved = "latest";
let cacheable = "true";
if (input === "latest" || input === "") { spec = "svelte-doctor@latest"; resolved = "latest"; }
else if (input.startsWith(".") || input.startsWith("/") || input.includes("://")) { spec = input; resolved = input; cacheable = "false"; }
else if (input.match(/^\d/)) { spec = `svelte-doctor@${input}`; resolved = input; }
else { spec = input; resolved = input; }
const out = process.env.GITHUB_OUTPUT;
if (out) {
  const fs = await import("node:fs");
  fs.appendFileSync(out, `spec=${spec}\nresolved=${resolved}\ncacheable=${cacheable}\n`);
} else {
  console.log(`spec=${spec} resolved=${resolved} cacheable=${cacheable}`);
}
