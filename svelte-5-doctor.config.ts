// svelte-doctor.config.ts — mirrors doctor.config.ts from React Doctor
// See https://github.com/Kimenzo/svelte-doctor#configure-rules
export default {
  rules: {
    "svelte-5-doctor/no-at-html-xss": "error",
    "svelte-5-doctor/legacy-export-let": "error",
    "svelte-5-doctor/no-effect-derived": "warn",
  },
  categories: {
    Performance: "warn",
  },
  ignore: ["dist/**", ".svelte-kit/**", "node_modules/**"],
};
