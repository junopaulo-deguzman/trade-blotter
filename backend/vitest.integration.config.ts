import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.integration.test.ts"],
    environment: "node",
    setupFiles: ["test/integration/setup.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
