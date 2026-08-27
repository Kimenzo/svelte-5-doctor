/**
 * eslint-plugin-svelte-doctor — ported from eslint-plugin-react-doctor
 * ESLint flat-config wrapper of svelte-plugin-svelte-doctor rules.
 */
import { SVELTE_DOCTOR_RULES } from "@svelte-doctor/core";

const rules: Record<string, unknown> = Object.fromEntries(
  SVELTE_DOCTOR_RULES.map((r) => [
    r.id.replace("svelte-doctor/", ""),
    {
      meta: { docs: { description: r.description, category: r.category }, severity: r.severity },
      create() { return {}; },
    },
  ])
);

const recommendedRules: Record<string, string> = Object.fromEntries(
  SVELTE_DOCTOR_RULES.filter((r) => r.severity !== "off").map((r) => [r.id, r.severity])
);

export const plugin = {
  meta: { name: "eslint-plugin-svelte-doctor", version: "0.1.0" },
  rules,
  configs: {
    recommended: { plugins: ["svelte-doctor"], rules: recommendedRules },
    flatRecommended: {
      plugins: { "svelte-doctor": { rules } as unknown as never },
      rules: recommendedRules,
    },
  },
};

export default plugin;
