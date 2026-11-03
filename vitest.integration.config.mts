import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// Integration tests hit the local Supabase stack (npx supabase start) using .env.local.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
