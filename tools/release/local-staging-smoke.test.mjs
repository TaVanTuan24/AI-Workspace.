import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatSummary,
  runLocalStagingSmoke,
  validateEnvFile
} from "./local-staging-smoke.mjs";

describe("local-staging-smoke", () => {
  it("refuses to run with .env", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-env-"));
    const envPath = path.join(temp, ".env");
    await fs.writeFile(envPath, "APP_VERSION=0.2.0\n", "utf8");

    await assert.rejects(
      () => validateEnvFile(envPath, {}),
      /Refusing to run local staging smoke with \.env/
    );
  });

  it("refuses missing env files", async () => {
    await assert.rejects(
      () => validateEnvFile(path.join(os.tmpdir(), "missing-uaiw-staging.env"), {}),
      /Env file not found/
    );
  });

  it("builds compose commands in dry-run mode without running Docker", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-"));
    const envPath = path.join(temp, ".env.staging");
    await fs.writeFile(envPath, "APP_VERSION=0.2.0\nAPI_BASE_URL=http://user:pass@localhost:4000?token=abc\n", "utf8");

    const report = await runLocalStagingSmoke({
      envFile: envPath,
      expectedVersion: "0.2.0",
      dryRun: true
    });

    assert.equal(report.result, "dry-run");
    assert.equal(report.commands.length, 2);
    assert.match(report.commands[0], /docker compose/);
    assert.match(report.commands[1], /up -d --build/);
    assert.equal(formatSummary(report).includes("user:pass"), false);
    assert.equal(formatSummary(report).includes("token=abc"), false);
  });

  it("writes a staging marker after a mocked successful verifier run", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-marker-"));
    const envPath = path.join(temp, ".env.staging");
    const releaseDir = path.join(temp, "release");
    const commands = [];
    await fs.writeFile(envPath, "APP_VERSION=0.2.0\nAPI_BASE_URL=http://localhost:4000\n", "utf8");

    const report = await runLocalStagingSmoke(
      {
        envFile: envPath,
        expectedVersion: "0.2.0",
        releaseDir
      },
      {
        runDockerPreflight: async () => passingPreflightReport(),
        writeDockerPreflightStatus: async () => ({ path: path.join(temp, "preflight-status.json"), content: {} }),
        runCommand: async (command, args) => {
          commands.push([command, args]);
        },
        waitReady: async () => undefined,
        verifyStaging: async () => ({
          result: "pass",
          checks: [
            { name: "health", status: "pass" },
            { name: "ready", status: "pass" },
            { name: "version", status: "pass" },
            { name: "health-details", status: "pass" }
          ]
        })
      }
    );

    const marker = JSON.parse(await fs.readFile(path.join(releaseDir, "staging-verification.json"), "utf8"));
    assert.equal(report.result, "pass");
    assert.equal(commands.length, 2);
    assert.equal(marker.version, "0.2.0");
    assert.deepEqual(marker.checksPassed, ["health", "ready", "version", "health-details"]);
    assert.equal(marker.chatSmoke, false);
    assert.equal(marker.liveProviderLoginTests, false);
    assert.equal(marker.envGenerated, false);
  });

  it("generates env only when --generate-env is provided", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-generate-"));
    const envPath = path.join(temp, ".env.staging");
    const releaseDir = path.join(temp, "release");
    let generatorCalled = false;

    await assert.rejects(
      () => runLocalStagingSmoke({
        envFile: envPath,
        expectedVersion: "0.2.0",
        releaseDir
      }),
      /Env file not found/
    );

    const report = await runLocalStagingSmoke(
      {
        envFile: envPath,
        expectedVersion: "0.2.0",
        releaseDir,
        generateEnv: true
      },
      {
        generateStagingEnv: async ({ out }) => {
          generatorCalled = true;
          await fs.writeFile(out, "APP_VERSION=0.2.0\nAPI_BASE_URL=http://localhost:4000\n", "utf8");
        },
        runDockerPreflight: async () => passingPreflightReport(),
        writeDockerPreflightStatus: async () => ({ path: path.join(temp, "preflight-status.json"), content: {} }),
        runCommand: async () => undefined,
        waitReady: async () => undefined,
        verifyStaging: async () => ({
          result: "pass",
          checks: [{ name: "health", status: "pass" }]
        })
      }
    );

    const marker = JSON.parse(await fs.readFile(path.join(releaseDir, "staging-verification.json"), "utf8"));
    assert.equal(generatorCalled, true);
    assert.equal(report.envGenerated, true);
    assert.equal(marker.envGenerated, true);
  });

  it("runs --preflight-only and exits without compose up", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-preflight-"));
    const envPath = path.join(temp, ".env.staging");
    const statusPath = path.join(temp, "preflight-status.json");
    const commands = [];
    await fs.writeFile(envPath, "APP_VERSION=0.2.0\nAPI_BASE_URL=http://localhost:4000\n", "utf8");

    const report = await runLocalStagingSmoke(
      {
        envFile: envPath,
        preflightOnly: true
      },
      {
        runDockerPreflight: async () => passingPreflightReport(),
        preflightStatusPath: statusPath,
        runCommand: async (command, args) => {
          commands.push([command, args]);
        }
      }
    );

    assert.equal(report.result, "preflight-pass");
    assert.equal(commands.length, 0);
    assert.match(formatSummary(report), /Docker preflight/);
  });

  it("fails before compose up when Docker daemon is unavailable and does not write marker", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-daemon-down-"));
    const envPath = path.join(temp, ".env.staging");
    const releaseDir = path.join(temp, "release");
    const statusPath = path.join(temp, "preflight-status.json");
    const commands = [];
    await fs.writeFile(envPath, "APP_VERSION=0.2.0\nAPI_BASE_URL=http://localhost:4000\n", "utf8");

    await assert.rejects(
      () => runLocalStagingSmoke(
        {
          envFile: envPath,
          expectedVersion: "0.2.0",
          releaseDir
        },
        {
          runDockerPreflight: async () => failingDaemonPreflightReport(),
          preflightStatusPath: statusPath,
          runCommand: async (command, args) => {
            commands.push([command, args]);
          }
        }
      ),
      /Docker preflight failed/
    );

    assert.equal(commands.length, 0);
    await assert.rejects(
      () => fs.access(path.join(releaseDir, "staging-verification.json")),
      /ENOENT/
    );
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    assert.equal(status.dockerDaemon, "unavailable");
  });
});

function passingPreflightReport() {
  return {
    result: "pass",
    checks: {
      dockerCli: { ok: true, status: "ok", detail: "Docker version 27" },
      dockerCompose: { ok: true, status: "ok", detail: "Docker Compose version v2" },
      dockerDaemon: { ok: true, status: "ok", detail: "\"27\"" }
    },
    nextSteps: []
  };
}

function failingDaemonPreflightReport() {
  return {
    result: "fail",
    failureCode: "docker_daemon_unavailable",
    checks: {
      dockerCli: { ok: true, status: "ok", detail: "Docker version 27" },
      dockerCompose: { ok: true, status: "ok", detail: "Docker Compose version v2" },
      dockerDaemon: {
        ok: false,
        status: "fail",
        code: "docker_daemon_unavailable",
        message: "Docker daemon is unavailable.",
        detail: "daemon down"
      }
    },
    nextSteps: ["Start Docker Desktop.", "Wait until `docker info` succeeds."]
  };
}
