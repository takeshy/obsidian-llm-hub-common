import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // The obsidian package ships types only, so tests run against a small stand-in.
  resolve: { alias: { obsidian: path.resolve(__dirname, "test/mocks/obsidian.ts") } },
  test: { include: ["src/**/*.test.ts"] },
});
