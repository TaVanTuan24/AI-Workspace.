import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { formatSummary, runTagDryRun } from "./tag-dry-run.mjs";

describe("tag-dry-run", () => {
  it("passes required release checks while warning on missing marker and cosign", async () => {
    const releaseDir = await createReleaseDir({ includeSbom: true });
    const report = await runTagDryRun(
      { version: "0.3.0", releaseDir },
      {
        commandExists: async () => false,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false })
      }
    );

    assert.equal(report.result, "pass");
    assert.equal(report.checks.find((check) => check.name === "SBOM exists").status, "pass");
    assert.equal(report.checks.find((check) => check.name === "staging verification marker exists").status, "warn");
    assert.equal(report.checks.find((check) => check.name === "cosign available").status, "warn");
    assert.equal(report.nextSteps.some((command) => command.includes("release:staging:env")), true);
    assert.equal(report.nextSteps.some((command) => command.includes("release:operator:status")), true);
    assert.equal(report.nextSteps.some((command) => command.includes("RELEASE_OPERATOR_HANDOFF")), true);
    assert.match(formatSummary(report), /release:staging:local/);
    assert.equal(report.manualCommands.some((command) => command.startsWith("git tag -a v0.3.0")), true);
  });

  it("fails when SBOM is missing", async () => {
    const releaseDir = await createReleaseDir({ includeSbom: false });
    const report = await runTagDryRun(
      { version: "0.3.0", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false })
      }
    );

    assert.equal(report.result, "fail");
    assert.equal(report.checks.find((check) => check.name === "SBOM exists").status, "fail");
  });

  it("detects version mismatch", async () => {
    const releaseDir = await createReleaseDir({ includeSbom: true });
    const report = await runTagDryRun(
      { version: "9.9.9", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({ ok: false })
      }
    );

    assert.equal(report.result, "fail");
    assert.equal(report.checks.find((check) => check.name === "workspace version matches target").status, "fail");
  });

  it("accepts a safe staging marker", async () => {
    const releaseDir = await createReleaseDir({ includeSbom: true });
    await fs.writeFile(
      path.join(releaseDir, "staging-verification.json"),
      JSON.stringify({
        version: "0.3.0",
        verifiedAt: new Date().toISOString(),
        baseUrl: "http://localhost:4000",
        checksPassed: ["health", "ready", "version", "health-details"],
        chatSmoke: false,
        liveProviderLoginTests: false
      }),
      "utf8"
    );

    const report = await runTagDryRun(
      { version: "0.3.0", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "clean" })
      }
    );

    assert.equal(report.result, "pass");
    assert.equal(report.checks.find((check) => check.name === "staging verification marker exists").status, "pass");
    assert.deepEqual(report.nextSteps, []);
    assert.match(formatSummary(report), /Staging marker present/);
  });

  it("prints Docker resume guidance when preflight status says daemon unavailable", async () => {
    const releaseDir = await createReleaseDir({ includeSbom: true });
    const report = await runTagDryRun(
      { version: "0.3.0", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "clean" }),
        readDockerPreflightStatus: async () => ({
          ok: true,
          content: {
            dockerCli: "ok",
            dockerCompose: "ok",
            dockerDaemon: "unavailable",
            markerGenerated: false
          }
        })
      }
    );

    const summary = formatSummary(report);
    assert.equal(report.result, "pass");
    assert.equal(report.warnings.some((warning) => warning.includes("Docker daemon was unavailable")), true);
    assert.equal(report.nextSteps.some((command) => command === "docker info"), true);
    assert.match(summary, /preflight-only/);
    assert.match(summary, /release:operator:status/);
    assert.match(summary, /release:tag:dry-run/);
  });

  it("warns that final tag must be run in a real Git checkout", async () => {
    const releaseDir = await createReleaseDir({ includeSbom: true });
    const report = await runTagDryRun(
      { version: "0.3.0", releaseDir },
      {
        commandExists: async () => true,
        gitStatus: async () => ({ status: "unknown", reason: "not a git repository" }),
        readDockerPreflightStatus: async () => ({ ok: false })
      }
    );

    assert.equal(report.warnings.some((warning) => warning.includes("real Git checkout")), true);
  });
});

async function createReleaseDir({ includeSbom }) {
  const releaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-release-"));
  const files = {
    "release-manifest.json": JSON.stringify({ name: "unified-ai-workspace", version: "0.3.0", files: [] }, null, 2) + "\n"
  };
  if (includeSbom) files["sbom.cyclonedx.json"] = JSON.stringify({ bomFormat: "CycloneDX" }) + "\n";

  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(releaseDir, name), content, "utf8");
  }

  const checksumLines = [];
  for (const [name, content] of Object.entries(files)) {
    checksumLines.push(`${crypto.createHash("sha256").update(content).digest("hex")}  ${name}`);
  }
  await fs.writeFile(path.join(releaseDir, "checksums.sha256"), `${checksumLines.join("\n")}\n`, "utf8");

  return releaseDir;
}
