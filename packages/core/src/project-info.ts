/**
 * Project Info — ported from react-doctor-source/packages/core/src/project-info
 * Adapted for Svelte: detects Svelte version, SvelteKit, TypeScript, runes mode.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectInfo } from "./types.js";

export const detectSvelteProject = async (directory: string): Promise<ProjectInfo> => {
  let svelteVersion = "unknown";
  let isSvelteKit = false;
  let hasTypeScript = false;
  let framework: ProjectInfo["framework"] = "unknown";

  const pkgPath = join(directory, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.svelte) {
        // strip ^~ >=
        const raw = String(deps.svelte).replace(/^[^\d]*/, "");
        svelteVersion = raw || "unknown";
        const major = Number.parseInt(raw.split(".")[0] ?? "0", 10);
        if (!Number.isNaN(major)) {
          if (major >= 5) framework = "svelte5";
          else if (major >= 3) framework = "svelte4";
        }
      }
      if (deps["@sveltejs/kit"]) {
        isSvelteKit = true;
        framework = "sveltekit";
      }
      if (deps.typescript || deps["svelte-check"]) hasTypeScript = true;
    } catch {}
  }

  if (existsSync(join(directory, "svelte.config.js")) || existsSync(join(directory, "svelte.config.ts"))) {
    if (framework === "unknown") framework = "svelte5";
  }
  if (existsSync(join(directory, "tsconfig.json"))) hasTypeScript = true;

  // runes detection: check svelte.config.js compilerOptions.runes
  let runesMode = framework === "svelte5" || framework === "sveltekit";
  try {
    const configJs = existsSync(join(directory, "svelte.config.js"))
      ? readFileSync(join(directory, "svelte.config.js"), "utf-8")
      : existsSync(join(directory, "svelte.config.ts"))
        ? readFileSync(join(directory, "svelte.config.ts"), "utf-8")
        : "";
    if (configJs.includes("runes: false") || configJs.includes("runes:false")) runesMode = false;
  } catch {}

  return { directory, svelteVersion, isSvelteKit, hasTypeScript, framework, runesMode };
};
