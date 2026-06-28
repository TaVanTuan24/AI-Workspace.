import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatSummary,
  generateStagingEnv,
  renderEnv,
  validateGeneratedEnv
} from "./staging-env.mjs";

describe("staging-env", () => {
  it("generates .env.staging from the example without printing secrets", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-env-"));
    const out = path.join(temp, ".env.staging");
    const template = path.join(temp, ".env.staging.example");
    const gitignore = path.join(temp, ".gitignore");
    await fs.copyFile(".env.staging.example", template);
    await fs.writeFile(gitignore, ".env\n.env.*\n!.env.example\n!.env.*.example\n", "utf8");

    const summary = await generateStagingEnv({ out, template, force: false });
    const content = await fs.readFile(out, "utf8");
    const formatted = formatSummary(summary);

    assert.match(content, /Generated local staging env/);
    assert.equal(content.includes("replace-with-local-random-secret"), false);
    assert.equal(content.includes("replace-with-local-32-byte-base64-key"), false);
    assert.equal(summary.generatedKeysCount >= 5, true);
    for (const key of summary.generatedKeys) {
      const value = content.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1];
      assert.ok(value);
      assert.equal(formatted.includes(value), false);
    }
  });

  it("refuses overwrite without --force and supports --force", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-force-"));
    const out = path.join(temp, ".env.staging");
    const template = path.join(temp, ".env.staging.example");
    await fs.copyFile(".env.staging.example", template);
    await fs.writeFile(out, "existing=true\n", "utf8");

    await assert.rejects(() => generateStagingEnv({ out, template }), /Refusing to overwrite/);
    await generateStagingEnv({ out, template, force: true });
    const content = await fs.readFile(out, "utf8");
    assert.match(content, /SESSION_MASTER_KEY=/);
  });

  it("refuses .env targets by default", async () => {
    await assert.rejects(() => generateStagingEnv({ out: ".env" }), /Refusing to write \.env/);
  });

  it("generates sufficiently strong required secrets and no provider credentials", () => {
    const rendered = renderEnv([
      "SESSION_MASTER_KEY=replace-with-local-32-byte-base64-key",
      "NOTIFICATION_SECRET_ENCRYPTION_KEY=replace-with-local-32-byte-base64-key",
      "APP_SECRET=replace-with-local-random-secret",
      "API_KEY_HASH_SECRET=replace-with-local-random-secret",
      "INTERNAL_API_KEY=replace-with-local-random-internal-api-key",
      "PROVIDER_API_KEY="
    ].join("\n"));

    assert.equal(Buffer.from(rendered.values.SESSION_MASTER_KEY, "base64").length, 32);
    assert.equal(Buffer.from(rendered.values.NOTIFICATION_SECRET_ENCRYPTION_KEY, "base64").length, 32);
    assert.equal(rendered.values.INTERNAL_API_KEY.length >= 24, true);
    assert.equal(rendered.values.PROVIDER_API_KEY, "");
  });

  it("validates gitignore coverage and fails on required placeholders", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uaiw-staging-validate-"));
    const gitignore = path.join(temp, ".gitignore");
    await fs.writeFile(gitignore, ".env\n.env.*\n!.env.*.example\n", "utf8");

    const result = await validateGeneratedEnv({
      outPath: path.join(process.cwd(), ".env.staging"),
      gitignorePath: gitignore,
      content: "SESSION_MASTER_KEY=replace-with-local-32-byte-base64-key\n",
      values: {
        SESSION_MASTER_KEY: "replace-with-local-32-byte-base64-key",
        NOTIFICATION_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, "a").toString("base64"),
        APP_SECRET: "x".repeat(32),
        API_KEY_HASH_SECRET: "x".repeat(32),
        INTERNAL_API_KEY: "x".repeat(32),
        DATABASE_URL: "file:./staging.db",
        REDIS_URL: "redis://redis:6379",
        API_BASE_URL: "http://localhost:4000",
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:4000",
        PROVIDER_HEALTH_SCHEDULER_ENABLED: "false"
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("SESSION_MASTER_KEY")), true);
  });
});
