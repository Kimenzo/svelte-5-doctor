/**
 * svelte-plugin-svelte-doctor — ported from oxlint-plugin-react-doctor
 * Oxlint plugin had 287 rules via Rust. Here we expose same rule registry
 * via pure JS visitors using svelte/compiler for Svelte 5.
 * Consumers: svelte-doctor CLI (via @svelte-doctor/core) and eslint-plugin.
 */
export { SVELTE_DOCTOR_RULES, RULE_MAP, RULE_IDS } from "svelte-5-doctor-core";
export { defineRule } from "./define-rule.js";
import { SVELTE_DOCTOR_RULES } from "svelte-5-doctor-core";

export const plugin = {
  name: "svelte-plugin-svelte-5-doctor",
  version: "0.1.0",
  rules: Object.fromEntries(SVELTE_DOCTOR_RULES.map((r) => [r.id, r])),
};

export const recommended = {
  plugins: ["svelte-doctor"],
  rules: Object.fromEntries(
    SVELTE_DOCTOR_RULES.filter((r) => r.severity !== "off").map((r) => [r.id, r.severity])
  ),
};

export default plugin;
