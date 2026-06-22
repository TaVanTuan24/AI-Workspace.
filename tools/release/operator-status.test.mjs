import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { formatSummary, runOperatorStatus } from "./operator-status.mjs";

describe("operator-status", () => {
  it("reports blocked status when staging marker is missing without printing env contents", async () => {
    const { releaseDir, envFile } = await createFixture({ marker: false });
    await fs.writeFile(envFile, "INTERNAL_API_KEY=do-not-print-this-secret\n", "utf8");

    const report = await runOperatorStatus(
      { version: "0.2.0", releaseDir },
      {
        commandExists: async () => false,
        gitStatus: async () => ({ status: "unknown", reason: "not a git repository" }),
        readDockerPreflightStatus: async () => ({
          ok: true,
          content: { dockerDaemon: "unavailable", markerGenerated: false }
        }),
        envFile
      }
    );
    const summary = formatSummary(report);

    assert.equal(report.result, "blocked");
    assert.equal(report.rows.find((row) => row.name === "staging marker").status, "blocked");
    assert.match(summary, /Docker Desktop/);
    assert.equal(summary.includes("do-not-print-this-secret"), false);
  });

  it("strict mode fails when staging marker is missing", async () => {
    const { releaseDir, envFile } = await createFixture({ marker: false });

    const report = await runOperatorStatus(
      { version: "0.2.0", releaseDir, strict: true },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false }),
        envFile
      }
    );

    assert.equal(report.result, "fail");
  });

  it("warns when cosign is missing and fails when cosign is required", async () => {
    const { releaseDir, envFile } = await createFixture({ marker: true });

    const advisory = await runOperatorStatus(
      { version: "0.2.0", releaseDir },
      {
        commandExists: async () => false,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false }),
        envFile
      }
    );
    const strict = await runOperatorStatus(
      { version: "0.2.0", releaseDir, requireCosign: true },
      {
        commandExists: async () => false,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false }),
        envFile
      }
    );

    assert.equal(advisory.rows.find((row) => row.name === "cosign").status, "warn");
    assert.equal(strict.rows.find((row) => row.name === "cosign").status, "fail");
    assert.equal(strict.result, "fail");
  });

  it("warns when no git repo is available", async () => {
    const { releaseDir, envFile } = await createFixture({ marker: true });

    const report = await runOperatorStatus(
      { version: "0.2.0", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "unknown", reason: "not a git repository" }),
        readDockerPreflightStatus: async () => ({ ok: false }),
        envFile
      }
    );

    assert.equal(report.rows.find((row) => row.name === "git checkout").status, "warn");
    assert.match(formatSummary(report), /real Git checkout/);
  });

  it("reports .env.staging as present and gitignored", async () => {
    const { releaseDir, envFile } = await createFixture({ marker: true });

    const report = await runOperatorStatus(
      { version: "0.2.0", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false }),
        envFile
      }
    );

    const envRow = report.rows.find((row) => row.name === ".env.staging");
    assert.equal(envRow.status, "pass");
    assert.match(envRow.detail, /gitignored/);
  });

  it("fails on version mismatch and prints a next action", async () => {
    const { releaseDir, envFile } = await createFixture({ marker: true });

    const report = await runOperatorStatus(
      { version: "9.9.9", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false }),
        envFile
      }
    );

    assert.equal(report.result, "fail");
    assert.equal(report.rows.find((row) => row.name === "workspace version").status, "fail");
    assert.ok(report.nextAction);
  });
});

async function createFixture({ marker }) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-operator-status-"));
  const releaseDir = path.join(temp, "release");
  const envFile = path.join(temp, ".env.staging");
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.writeFile(path.join(releaseDir, "release-manifest.json"), JSON.stringify({ version: "0.2.0" }), "utf8");
  await fs.writeFile(path.join(releaseDir, "checksums.sha256"), "abc  release-manifest.json\n", "utf8");
  await fs.writeFile(path.join(releaseDir, "sbom.cyclonedx.json"), JSON.stringify({ bomFormat: "CycloneDX" }), "utf8");
  await fs.writeFile(envFile, "APP_VERSION=0.2.0\n", "utf8");
  if (marker) {
    await fs.writeFile(
      path.join(releaseDir, "staging-verification.json"),
      JSON.stringify({
        version: "0.2.0",
        verifiedAt: new Date().toISOString(),
        baseUrl: "http://localhost:4000",
        checksPassed: ["health", "ready", "version"],
        chatSmoke: false,
        liveProviderLoginTests: false,
        envGenerated: false
      }),
      "utf8"
    );
  }
  return { releaseDir, envFile };
}
