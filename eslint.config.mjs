import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Separate workspaces and agent tooling are not part of this app.
    ".claude/**",
    ".superpowers/**",
    "BetvsFriends-speed/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno Edge Function entrypoints (pure helpers in supabase/functions/_shared ARE linted).
    "supabase/functions/*/index.ts",
  ]),
]);

export default eslintConfig;
