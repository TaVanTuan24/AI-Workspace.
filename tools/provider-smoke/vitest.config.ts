import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  },
  resolve: {
    alias: {
      "@uaiw/shared/types/provider.js": fileURLToPath(
        new URL("../../packages/shared/src/types/provider.ts", import.meta.url)
      )
    }
  }
});
