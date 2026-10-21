import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/server/src/**/*.test.ts", "packages/shared/src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
