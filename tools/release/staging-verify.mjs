#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 5_000;
const FORBIDDEN_RESPONSE_KEYS = [
  "storageState",
  "cookie",
  "authorization",
  "apiKey",
  "signingSecret",
  "encryptedSigningSecret",
  "encryptedUrl",
  "session",
  "password"
];

const SAFE_SETTINGS_ENDPOINTS = [
  "/settings/overview",
  "/settings/provider-recovery/scheduler-status",
  "/settings/provider-health/incidents?limit=10",
  "/settings/provider-health/diagnostics-runs?limit=10",
  "/settings/notification-delivery/dead-letters?limit=10",
  "/settings/workspace/admin-overview",
  "/settings/workspace/activity",
  "/settings/workspace/schedulers",
  "/settings/workspace/quota",
  "/settings/workspace/quota/report",
  "/settings/workspace/invites/email-delivery-status"
];

export function parseArgs(argv) {
  const options = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    includeChatSmoke: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      options.baseUrl = argv[++index];
    } else if (arg === "--expected-version") {
      options.expectedVersion = argv[++index];
    } else if (arg === "--api-key-env") {
      options.apiKeyEnv = argv[++index];
    } else if (arg === "--local-user-id") {
      options.localUserId = argv[++index];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]);
    } else if (arg === "--include-chat-smoke") {
      options.includeChatSmoke = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function usage() {
  return [
    "Usage:",
    "  corepack pnpm release:staging:verify --base-url http://localhost:3000 --expected-version 0.3.0",
    "  corepack pnpm release:staging:verify --base-url http://localhost:3000 --expected-version 0.3.0 --api-key-env UAIW_STAGING_API_KEY",
    "",
    "Safe defaults:",
    "  - Performs safe GET checks only by default.",
    "  - Does not submit prompts or call /v1/chat/completions by default.",
    "  - Skips settings endpoints unless --local-user-id is provided.",
    "  - Redacts credential-like URL and header values in output."
  ].join("\n");
}

export function redactSensitiveText(value) {
  if (typeof value !== "string") return value;

  let output = value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  output = output.replace(/(authorization\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");

  try {
    const url = new URL(output);
    if (url.username) url.username = "[redacted]";
    if (url.password) url.password = "[redacted]";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|authorization/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    output = url.toString();
  } catch {
    output = output.replace(
      /([?&](?:token|api_key|apiKey|key|secret|password|authorization)=)[^&\s]+/gi,
      "$1[redacted]"
    );
    output = output.replace(/\/\/([^:/\s]+):([^@/\s]+)@/g, "//[redacted]:[redacted]@");
  }

  return output;
}

export function assertNoSensitiveFields(payload, context = "response") {
  const findings = [];
  const forbidden = FORBIDDEN_RESPONSE_KEYS.map((key) => normalizeKey(key));

  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const normalized = normalizeKey(key);
      const matched = forbidden.find((blocked) => normalized.includes(blocked));
      const childPath = path ? `${path}.${key}` : key;
      if (matched) findings.push(childPath);
      visit(child, childPath);
    }
  }

  visit(payload, "");

  if (findings.length > 0) {
    const details = findings.slice(0, 5).join(", ");
    throw new Error(`Sensitive-looking field found in ${context}: ${details}`);
  }
}

function normalizeKey(key) {
  return String(key).replace(/[_-]/g, "").toLowerCase();
}

export async function verifyStaging(options) {
  validateOptions(options);

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const expectedVersion = options.expectedVersion;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const apiKey = resolveApiKey(options);

  const checks = [];
  const run = async (name, fn) => {
    const startedAt = Date.now();
    try {
      const detail = await fn();
      checks.push({
        name,
        status: detail?.status ?? "pass",
        durationMs: Date.now() - startedAt,
        ...(detail?.summary ? { summary: detail.summary } : {}),
        ...(detail?.reason ? { reason: detail.reason } : {})
      });
    } catch (error) {
      checks.push({
        name,
        status: "fail",
        durationMs: Date.now() - startedAt,
        reason: redactSensitiveText(error instanceof Error ? error.message : String(error))
      });
    }
  };

  await run("health", async () => {
    const json = await getJson(baseUrl, "/health", { timeoutMs });
    if (json.status !== 200 || json.body?.ok !== true) throw new Error(`/health returned ${json.status}`);
    return { summary: "ok" };
  });

  await run("ready", async () => {
    const json = await getJson(baseUrl, "/ready", { timeoutMs });
    if (json.status !== 200 || json.body?.ok !== true) throw new Error(`/ready returned ${json.status}`);
    return { summary: "ready" };
  });

  await run("health-details", async () => {
    const json = await getJson(baseUrl, "/health/details", { timeoutMs });
    if (json.status !== 200 || json.body?.ok !== true) throw new Error(`/health/details returned ${json.status}`);
    return {
      summary: `version=${json.body?.version ?? "unknown"} buildSource=${json.body?.buildSource ?? "unknown"}`
    };
  });

  await run("version", async () => {
    const json = await getJson(baseUrl, "/version", { timeoutMs });
    const actualVersion = json.body?.version;
    if (json.status !== 200) throw new Error(`/version returned ${json.status}`);
    if (actualVersion !== expectedVersion) {
      throw new Error(`Expected version ${expectedVersion}, got ${actualVersion ?? "unknown"}`);
    }
    return { summary: actualVersion };
  });

  if (apiKey) {
    await run("openai-models", async () => {
      const json = await getJson(baseUrl, "/v1/models", {
        timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (json.status !== 200 || !Array.isArray(json.body?.data)) {
        throw new Error(`/v1/models returned ${json.status}`);
      }
      return { summary: `${json.body.data.length} models` };
    });
  } else {
    checks.push({
      name: "openai-models",
      status: "skip",
      durationMs: 0,
      reason: options.apiKeyEnv
        ? `API key env ${options.apiKeyEnv} is not set`
        : "No --api-key-env provided"
    });
  }

  if (options.includeChatSmoke) {
    await run("openai-chat-smoke", async () => {
      if (!apiKey) return { status: "skip", reason: "No API key provided" };
      const model = process.env.UAIW_STAGING_CHAT_SMOKE_MODEL;
      if (!model) return { status: "skip", reason: "UAIW_STAGING_CHAT_SMOKE_MODEL is not set" };
      if (!/^(mock|local)([-_.:a-z0-9]*)$/i.test(model)) {
        return { status: "skip", reason: "Configured chat smoke model is not mock/local" };
      }

      const json = await postJson(baseUrl, "/v1/chat/completions", {
        timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` },
        body: {
          model,
          messages: [{ role: "user", content: "staging smoke" }],
          stream: false,
          max_tokens: 8
        }
      });
      if (json.status < 200 || json.status >= 300) throw new Error(`/v1/chat/completions returned ${json.status}`);
      return { summary: "mock/local chat smoke completed" };
    });
  } else {
    checks.push({
      name: "openai-chat-smoke",
      status: "skip",
      durationMs: 0,
      reason: "Skipped by default; pass --include-chat-smoke for mock/local provider only"
    });
  }

  if (options.localUserId) {
    for (const endpoint of SAFE_SETTINGS_ENDPOINTS) {
      await run(`settings ${endpoint.split("?")[0]}`, async () => {
        const json = await getJson(baseUrl, endpoint, {
          timeoutMs,
          headers: { "x-local-user-id": options.localUserId }
        });
        if (json.status < 200 || json.status >= 300) {
          throw new Error(`${endpoint} returned ${json.status}`);
        }
        return { summary: "safe JSON response" };
      });
    }
  } else {
    checks.push({
      name: "settings-safe-checks",
      status: "skip",
      durationMs: 0,
      reason: "No --local-user-id provided"
    });
  }

  const result = checks.some((check) => check.status === "fail") ? "fail" : "pass";
  return {
    baseUrl: redactSensitiveText(baseUrl.toString().replace(/\/$/, "")),
    expectedVersion,
    checks,
    result
  };
}

function validateOptions(options) {
  if (!options?.baseUrl) throw new Error("--base-url is required");
  if (!options?.expectedVersion) throw new Error("--expected-version is required");
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function resolveApiKey(options) {
  if (options.apiKey) return options.apiKey;
  if (!options.apiKeyEnv) return undefined;
  return process.env[options.apiKeyEnv];
}

async function getJson(baseUrl, endpoint, options) {
  return fetchJson(baseUrl, endpoint, { ...options, method: "GET" });
}

async function postJson(baseUrl, endpoint, options) {
  return fetchJson(baseUrl, endpoint, { ...options, method: "POST" });
}

async function fetchJson(baseUrl, endpoint, options) {
  const url = new URL(endpoint, baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error(`${url.pathname} returned non-JSON content type ${contentType || "unknown"}`);
    }

    const body = await response.json();
    assertNoSensitiveFields(body, url.pathname);
    return { status: response.status, body };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${url.pathname} timed out after ${options.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function formatConsoleSummary(report) {
  const lines = [
    `Staging verification for ${report.baseUrl}`,
    `Expected version: ${report.expectedVersion}`,
    ""
  ];

  for (const check of report.checks) {
    const label = check.status === "pass" ? "PASS" : check.status === "skip" ? "SKIP" : "FAIL";
    const detail = check.summary ?? check.reason ?? "";
    lines.push(`${label} ${check.name} (${check.durationMs}ms)${detail ? ` - ${detail}` : ""}`);
  }

  lines.push("");
  lines.push(`Result: ${report.result.toUpperCase()}`);
  return lines.join("\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const report = await verifyStaging(options);
    if (!options.json) {
      console.log(formatConsoleSummary(report));
      console.log("");
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.result !== "pass") process.exitCode = 1;
  } catch (error) {
    console.error(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
