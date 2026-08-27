// svelte-doctor.config.ts — mirrors doctor.config.ts from React Doctor
// See https://github.com/Kimenzo/svelte-doctor#configure-rules
export default {
  rules: {
    "svelte-doctor/no-at-html-xss": "error",
    "svelte-doctor/legacy-export-let": "error",
    "svelte-doctor/no-effect-derived": "warn",
  },
  categories: {
    Performance: "warn",
  },
  ignore: ["dist/**", ".svelte-kit/**", "node_modules/**"],
};
