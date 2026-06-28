import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import {
  assertNoSensitiveFields,
  redactSensitiveText,
  verifyStaging
} from "./staging-verify.mjs";

describe("staging-verify", () => {
  let server;
  let baseUrl;
  const requests = [];

  before(async () => {
    server = http.createServer((req, res) => {
      requests.push({
        url: req.url,
        authorization: req.headers.authorization,
        localUserId: req.headers["x-local-user-id"]
      });

      if (req.url === "/health") return json(res, 200, { ok: true });
      if (req.url === "/ready") return json(res, 200, { ok: true });
      if (req.url === "/health/details") return json(res, 200, { ok: true, version: "0.3.0", buildSource: "test" });
      if (req.url === "/version") return json(res, 200, { version: "0.3.0" });
      if (req.url === "/bad-version") return json(res, 200, { version: "0.1.0" });
      if (req.url === "/secret") return json(res, 200, { storageState: {} });
      if (req.url === "/v1/models") return json(res, 200, { object: "list", data: [] });
      if (req.url === "/settings/overview") return json(res, 200, { providers: [] });
      if (req.url === "/settings/provider-health/incidents?limit=10") return json(res, 200, { data: [] });
      if (req.url === "/settings/provider-health/diagnostics-runs?limit=10") return json(res, 200, { data: [] });
      if (req.url === "/settings/notification-delivery/dead-letters?limit=10") return json(res, 200, { deadLetters: [] });
      if (req.url === "/settings/workspace/admin-overview") return json(res, 200, { overview: {} });
      if (req.url === "/settings/workspace/activity") return json(res, 200, { data: [] });
      if (req.url === "/settings/workspace/schedulers") return json(res, 200, { schedulers: [] });
      if (req.url === "/settings/workspace/quota") return json(res, 200, { quota: {} });
      if (req.url === "/settings/workspace/quota/report") return json(res, 200, { report: {} });
      if (req.url === "/settings/workspace/invites/email-delivery-status") return json(res, 200, { stats: {} });

      return json(res, 404, { error: "not found" });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("passes health, version, models, and settings checks against a local server", async () => {
    const report = await verifyStaging({
      baseUrl,
      expectedVersion: "0.3.0",
      apiKey: "test-secret-key",
      localUserId: "release-qa"
    });

    assert.equal(report.result, "pass");
    assert.equal(report.checks.some((check) => check.name === "openai-chat-smoke" && check.status === "skip"), true);
    assert.equal(requests.some((request) => request.url === "/settings/overview" && request.localUserId === "release-qa"), true);
  });

  it("fails on version mismatch", async () => {
    const mismatchServer = http.createServer((req, res) => {
      if (req.url === "/health") return json(res, 200, { ok: true });
      if (req.url === "/ready") return json(res, 200, { ok: true });
      if (req.url === "/health/details") return json(res, 200, { ok: true, version: "0.1.0" });
      if (req.url === "/version") return json(res, 200, { version: "0.1.0" });
      return json(res, 404, { error: "not found" });
    });
    await new Promise((resolve) => mismatchServer.listen(0, "127.0.0.1", resolve));
    const address = mismatchServer.address();
    const report = await verifyStaging({
      baseUrl: `http://127.0.0.1:${address.port}`,
      expectedVersion: "0.3.0"
    });
    await new Promise((resolve) => mismatchServer.close(resolve));

    assert.equal(report.result, "fail");
    assert.match(report.checks.find((check) => check.name === "version").reason, /Expected version 0\.3\.0/);
  });

  it("rejects sensitive-looking response fields", () => {
    assert.throws(
      () => assertNoSensitiveFields({ nested: { encryptedSigningSecret: "hidden" } }, "test"),
      /Sensitive-looking field/
    );
  });

  it("marks unavailable endpoints as failures without throwing from verifyStaging", async () => {
    const unavailableServer = http.createServer((req, res) => {
      if (req.url === "/health") return json(res, 200, { ok: true });
      return json(res, 404, { error: "not found" });
    });
    await new Promise((resolve) => unavailableServer.listen(0, "127.0.0.1", resolve));
    const address = unavailableServer.address();
    const report = await verifyStaging({
      baseUrl: `http://127.0.0.1:${address.port}`,
      expectedVersion: "0.3.0"
    });
    await new Promise((resolve) => unavailableServer.close(resolve));

    assert.equal(report.result, "fail");
    assert.equal(report.checks.find((check) => check.name === "ready").status, "fail");
  });

  it("skips settings checks without a local user id", async () => {
    const report = await verifyStaging({ baseUrl, expectedVersion: "0.3.0" });
    const settings = report.checks.find((check) => check.name === "settings-safe-checks");

    assert.equal(settings.status, "skip");
  });

  it("redacts credential-like URL and API key values", () => {
    const redacted = redactSensitiveText(
      "GET https://user:pass@example.test/path?api_key=abc&token=def Authorization: Bearer super-secret"
    );

    assert.equal(redacted.includes("super-secret"), false);
    assert.equal(redacted.includes("api_key=abc"), false);
    assert.equal(redacted.includes("token=def"), false);
    assert.equal(redacted.includes("user:pass"), false);
  });
});

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
