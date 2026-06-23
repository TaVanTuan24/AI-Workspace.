import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: {
      UAIW_TEST_FAIL_ON_DEFAULT_WORKSPACE_FALLBACK: "true"
    }
  },
  resolve: {
    alias: {
      "@uaiw/shared/types/provider.js": fileURLToPath(
        new URL("../../packages/shared/src/types/provider.ts", import.meta.url)
      ),
      "@uaiw/shared/version.js": fileURLToPath(
        new URL("../../packages/shared/src/version.ts", import.meta.url)
      ),
      "@uaiw/provider-adapters/index.js": fileURLToPath(
        new URL("../../packages/provider-adapters/src/index.ts", import.meta.url)
      ),
      "@uaiw/provider-adapters/ProviderAdapter.js": fileURLToPath(
        new URL("../../packages/provider-adapters/src/ProviderAdapter.ts", import.meta.url)
      ),
      "@uaiw/provider-adapters/ProviderRegistry.js": fileURLToPath(
        new URL("../../packages/provider-adapters/src/ProviderRegistry.ts", import.meta.url)
      ),
      "@uaiw/session-vault/index.js": fileURLToPath(
        new URL("../../packages/session-vault/src/index.ts", import.meta.url)
      )
    }
  }
});
