import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "../../../../tools/ci/check-test-isolation.mjs");

describe("check-test-isolation.mjs", () => {
  it("should fail on risky patterns", () => {
    const fixturePath = path.resolve(__dirname, "../../../../tools/ci/__tests__/fixtures/risky.test.ts");
    const result = spawnSync("node", [SCRIPT_PATH, fixturePath], { encoding: "utf8" });

    expect(result.status).toBe(1);
    const stderr = result.stderr;
    
    // Check if it catches various risky patterns
    // test-isolation-allow-global-cleanup: testing the guardrail
    expect(stderr).toContain("deleteMany({})");
    // test-isolation-allow-global-cleanup: testing the guardrail
    expect(stderr).toContain("deleteMany()");
    // test-isolation-allow-global-cleanup: testing the guardrail
    expect(stderr).toContain("deleteMany({ where: {} })");
    // test-isolation-allow-global-cleanup: testing the guardrail
    expect(stderr).toContain("updateMany({ where: {} })");
    expect(stderr).toContain("$executeRaw");
    expect(stderr).toContain("$queryRawUnsafe");
    expect(stderr).toContain("TRUNCATE");
    // test-isolation-allow-raw-sql: testing the guardrail
    expect(stderr).toContain("DROP DATABASE");
    
    // Check if it rejects short reason
    // test-isolation-allow-raw-sql: testing the guardrail
    expect(stderr).toContain("VACUUM"); // The short reason one
    
    // Check total errors
    expect(stderr).toContain("Found 9 risky global DB cleanup");
  });

  it("should pass on safe patterns and properly allowed comments", () => {
    const fixturePath = path.resolve(__dirname, "../../../../tools/ci/__tests__/fixtures/safe.test.ts");
    const result = spawnSync("node", [SCRIPT_PATH, fixturePath], { encoding: "utf8" });

    // Should pass
    if (result.status !== 0) {
      console.error(result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Test isolation static check passed");
  });
});
