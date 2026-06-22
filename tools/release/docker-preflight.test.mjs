import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkDockerCli,
  checkDockerCompose,
  formatDockerPreflightSummary,
  runDockerPreflight,
  sanitizeDockerOutput
} from "./docker-preflight.mjs";

describe("docker-preflight", () => {
  it("reports Docker CLI missing with a friendly failure", async () => {
    const result = await checkDockerCli({
      runCommand: async () => {
        throw new Error("spawn docker ENOENT");
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "docker_cli_missing");
    assert.match(result.message, /Docker CLI/);
  });

  it("reports Docker Compose missing with a friendly failure", async () => {
    const result = await checkDockerCompose({
      runCommand: async () => {
        throw new Error("unknown command compose");
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "docker_compose_missing");
    assert.match(result.message, /Docker Compose/);
  });

  it("reports daemon unavailable with structured next steps", async () => {
    const result = await runDockerPreflight({}, {
      runCommand: async (_command, args) => {
        if (args[0] === "--version") return "Docker version 27.0.0";
        if (args[0] === "compose") return "Docker Compose version v2.28.0";
        throw new Error("error during connect: open //./pipe/dockerDesktopLinuxEngine: path includes C:\\Users\\someone");
      }
    });

    assert.equal(result.result, "fail");
    assert.equal(result.failureCode, "docker_daemon_unavailable");
    assert.equal(result.checks.dockerDaemon.status, "fail");
    assert.equal(result.nextSteps.some((step) => step.includes("Docker Desktop")), true);
    assert.equal(formatDockerPreflightSummary(result).includes("C:\\Users\\someone"), false);
  });

  it("passes when CLI, Compose, and daemon are available", async () => {
    const result = await runDockerPreflight({}, {
      runCommand: async (_command, args) => {
        if (args[0] === "--version") return "Docker version 27.0.0";
        if (args[0] === "compose") return "Docker Compose version v2.28.0";
        return "\"27.0.0\"";
      }
    });

    assert.equal(result.result, "pass");
    assert.equal(result.checks.dockerCli.ok, true);
    assert.equal(result.checks.dockerCompose.ok, true);
    assert.equal(result.checks.dockerDaemon.ok, true);
  });

  it("sanitizes and truncates Docker error output", async () => {
    const sanitized = sanitizeDockerOutput(
      `failed for https://user:pass@example.test?token=abc in C:\\Users\\alice\\docker ${"x".repeat(800)}`,
      120
    );

    assert.equal(sanitized.includes("user:pass"), false);
    assert.equal(sanitized.includes("token=abc"), false);
    assert.equal(sanitized.includes("C:\\Users\\alice"), false);
    assert.match(sanitized, /truncated/);
  });

  it("skips daemon when daemon is not required", async () => {
    const result = await runDockerPreflight({ requireDaemon: false }, {
      runCommand: async (_command, args) => {
        if (args[0] === "--version") return "Docker version 27.0.0";
        if (args[0] === "compose") return "Docker Compose version v2.28.0";
        throw new Error("daemon should not be checked");
      }
    });

    assert.equal(result.result, "pass");
    assert.equal(result.checks.dockerDaemon.status, "skipped");
  });
});
