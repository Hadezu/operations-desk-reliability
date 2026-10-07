import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    reporters: ["default", "json"],
    outputFile: { json: "evidence/vitest.json" },
  },
});
