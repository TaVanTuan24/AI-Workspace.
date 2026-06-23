import test from "node:test";
import assert from "node:assert/strict";
import { shouldExclude, forbiddenPackagePatterns } from "./lib.mjs";

test("Release Package Exclusions - Safe Files", () => {
  const safeFiles = [
    "package.json",
    "README.md",
    "src/index.ts",
    "apps/api/src/server.ts",
    ".env.example"
  ];

  for (const file of safeFiles) {
    assert.equal(shouldExclude(file), false, `Should not exclude safe file: ${file}`);
  }
});

test("Release Package Exclusions - Forbidden Files", () => {
  const forbiddenFiles = [
    ".env",
    ".env.staging",
    ".env.local",
    "node_modules/express/package.json",
    "apps/api/node_modules/cors/index.js",
    ".git/config",
    "var/sqlite.db",
    "var/sqlite.db-journal",
    "tmp/build.log",
    "coverage/lcov.info",
    "dist/index.js",
    "dist-release/unified-ai-workspace-0.3.0/package.json",
    "playwright-report/index.html",
    "test-results/test.xml",
    "browser-profiles/user1/Cookies",
    "storage-state/state.json",
    "prisma/dev.sqlite",
    "apps/api/src/test.tsbuildinfo"
  ];

  for (const file of forbiddenFiles) {
    assert.equal(shouldExclude(file), true, `Should exclude forbidden file: ${file}`);
  }
});
