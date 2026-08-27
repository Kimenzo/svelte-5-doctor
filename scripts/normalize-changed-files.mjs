// Ported from react-doctor-source/scripts/normalize-changed-files.mjs
export const normalizeChangedFiles = (files, prefix) => {
  const cleanPrefix = String(prefix || ".").replace(/^\.\/?/, "").replace(/\/$/, "");
  return files
    .map((f) => String(f).replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter((f) => !cleanPrefix || f.startsWith(cleanPrefix + "/") || f === cleanPrefix)
    .map((f) => (cleanPrefix && f.startsWith(cleanPrefix + "/") ? f.slice(cleanPrefix.length + 1) : f));
};
const prefix = process.argv[2] ?? ".";
const out = process.argv[3];
if (out && !process.argv.includes("--test")) {
  const fs = await import("node:fs");
  const stdin = fs.readFileSync(0, "utf-8");
  const files = stdin.split("\n").filter(Boolean);
  const normalized = normalizeChangedFiles(files, prefix);
  fs.writeFileSync(out, normalized.join("\n") + (normalized.length ? "\n" : ""));
}
