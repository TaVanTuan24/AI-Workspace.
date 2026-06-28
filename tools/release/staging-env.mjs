#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, root } from "./lib.mjs";

const DEFAULT_TEMPLATE = ".env.staging.example";
const DEFAULT_OUT = ".env.staging";
const REQUIRED_GENERATED_KEYS = new Set([
  "APP_SECRET",
  "SESSION_MASTER_KEY",
  "API_KEY_HASH_SECRET",
  "NOTIFICATION_SECRET_ENCRYPTION_KEY",
  "INTERNAL_API_KEY"
]);
const PROVIDER_CREDENTIAL_KEY_PARTS = [
  "PROVIDER_API_KEY",
  "PROVIDER_TOKEN",
  "PROVIDER_PASSWORD",
  "PROVIDER_SESSION",
  "STORAGE_STATE",
  "COOKIE"
];
const PLACEHOLDER_RE = /replace-with|change[_-]?me|changeme|placeholder|local-random-secret|local-32-byte-base64-key|local-random-internal-api-key/i;

export function parseArgs(argv) {
  const options = {
    out: DEFAULT_OUT,
    template: DEFAULT_TEMPLATE,
    force: false,
    printSummary: false,
    allowDotenv: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.out = argv[++index];
    } else if (arg === "--template") {
      options.template = argv[++index];
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--print-summary") {
      options.printSummary = true;
    } else if (arg === "--allow-dotenv") {
      options.allowDotenv = true;
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
    "  corepack pnpm release:staging:env --out .env.staging",
    "  corepack pnpm release:staging:env --out .env.staging --force",
    "  corepack pnpm release:staging:env --out .env.staging --print-summary",
    "",
    "This command writes local-only generated secrets to the target file and never prints secret values."
  ].join("\n");
}

export async function generateStagingEnv(options = {}, deps = {}) {
  const resolved = {
    out: DEFAULT_OUT,
    template: DEFAULT_TEMPLATE,
    force: false,
    allowDotenv: false,
    ...options
  };

  const templatePath = path.resolve(root, resolved.template);
  const outPath = path.resolve(root, resolved.out);
  validateOutPath(outPath, resolved);

  if (!resolved.force && await pathExists(outPath)) {
    throw new Error(`Refusing to overwrite existing env file: ${redactPath(outPath)}. Pass --force to replace it.`);
  }

  const template = await fs.readFile(templatePath, "utf8");
  const generatedAt = new Date().toISOString();
  const rendered = renderEnv(template, { generatedAt, randomBytes: deps.randomBytes || crypto.randomBytes });
  const validation = await validateGeneratedEnv({
    outPath,
    content: rendered.content,
    values: rendered.values,
    gitignorePath: path.join(root, ".gitignore")
  });

  if (!validation.ok) {
    throw new Error(`Generated staging env failed validation:\n- ${validation.errors.join("\n- ")}`);
  }

  await fs.writeFile(outPath, rendered.content, { encoding: "utf8", flag: resolved.force ? "w" : "wx" });

  return {
    outputPath: redactPath(outPath),
    generatedKeysCount: rendered.generatedKeys.length,
    copiedPlaceholderKeysCount: rendered.copiedPlaceholderKeys.length,
    generatedKeys: rendered.generatedKeys,
    copiedPlaceholderKeys: rendered.copiedPlaceholderKeys,
    nextCommand: `corepack pnpm release:staging:local --env-file ${redactPath(outPath)} --expected-version ${rendered.values.APP_VERSION || "0.3.0"} --base-url ${rendered.values.API_BASE_URL || "http://localhost:4000"} --down`
  };
}

export function renderEnv(template, deps = {}) {
  const randomBytes = deps.randomBytes || crypto.randomBytes;
  const values = {};
  const generatedKeys = [];
  const copiedPlaceholderKeys = [];
  const lines = [
    "# Generated local staging env for Unified AI Workspace.",
    "# Do not commit. Do not use production secrets.",
    ""
  ];

  for (const rawLine of template.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      lines.push(rawLine);
      continue;
    }

    const eq = rawLine.indexOf("=");
    if (eq <= 0) {
      lines.push(rawLine);
      continue;
    }

    const key = rawLine.slice(0, eq).trim();
    const originalValue = rawLine.slice(eq + 1);
    let value = originalValue;

    if (shouldGenerateSecret(key, originalValue)) {
      value = generateValueForKey(key, randomBytes);
      generatedKeys.push(key);
    } else if (PLACEHOLDER_RE.test(originalValue)) {
      copiedPlaceholderKeys.push(key);
    }

    values[key] = value;
    lines.push(`${key}=${value}`);
  }

  return {
    content: `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`,
    values,
    generatedKeys,
    copiedPlaceholderKeys
  };
}

function shouldGenerateSecret(key, value) {
  if (PROVIDER_CREDENTIAL_KEY_PARTS.some((part) => key.toUpperCase().includes(part))) return false;
  if (REQUIRED_GENERATED_KEYS.has(key)) return true;
  if (!PLACEHOLDER_RE.test(value)) return false;
  return /(^|_)(SECRET|KEY|TOKEN|HMAC|ENCRYPTION_KEY)($|_)/i.test(key);
}

function generateValueForKey(key, randomBytes = crypto.randomBytes) {
  if (key === "SESSION_MASTER_KEY" || key === "NOTIFICATION_SECRET_ENCRYPTION_KEY") {
    return randomBytes(32).toString("base64");
  }
  return randomBytes(32).toString("base64url");
}

function validateOutPath(outPath, options) {
  const base = path.basename(outPath);
  if (!options.allowDotenv && base === ".env") {
    throw new Error("Refusing to write .env from staging env generator. Use .env.staging.");
  }
  if (/prod|production/i.test(base)) {
    throw new Error(`Refusing production-looking env path: ${redactPath(outPath)}`);
  }
}

export async function validateGeneratedEnv({ outPath, content, values, gitignorePath }) {
  const errors = [];
  const relativeOut = normalizePath(path.relative(root, outPath));

  if (!await isPathGitignored(relativeOut, gitignorePath)) {
    errors.push(`${relativeOut} is not covered by .gitignore.`);
  }

  for (const key of REQUIRED_GENERATED_KEYS) {
    const value = values[key];
    if (!value || PLACEHOLDER_RE.test(value)) {
      errors.push(`${key} still contains a placeholder.`);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (PROVIDER_CREDENTIAL_KEY_PARTS.some((part) => key.toUpperCase().includes(part)) && value && PLACEHOLDER_RE.test(value) === false) {
      errors.push(`${key} appears to configure provider credentials; staging env generation must not create provider credentials.`);
    }
  }

  if (!isLocalDatabaseUrl(values.DATABASE_URL)) {
    errors.push("DATABASE_URL must be a local SQLite file or local/staging container hostname.");
  }
  if (!isLocalRedisUrl(values.REDIS_URL)) {
    errors.push("REDIS_URL must point to local/staging Redis.");
  }
  if (!isLocalHttpUrl(values.API_BASE_URL) || !isLocalHttpUrl(values.NEXT_PUBLIC_API_BASE_URL)) {
    errors.push("API_BASE_URL and NEXT_PUBLIC_API_BASE_URL must be local URLs.");
  }
  if (values.PROVIDER_HEALTH_SCHEDULER_ENABLED !== "false") {
    errors.push("PROVIDER_HEALTH_SCHEDULER_ENABLED must remain false for release smoke.");
  }
  if (/storage-state|provider-session/i.test(content)) {
    errors.push("Generated env must not reference provider session/storageState paths.");
  }
  if (Buffer.from(values.SESSION_MASTER_KEY || "", "base64").length !== 32) {
    errors.push("SESSION_MASTER_KEY must be base64 and decode to 32 bytes.");
  }
  if (Buffer.from(values.NOTIFICATION_SECRET_ENCRYPTION_KEY || "", "base64").length !== 32) {
    errors.push("NOTIFICATION_SECRET_ENCRYPTION_KEY must be base64 and decode to 32 bytes.");
  }
  if ((values.INTERNAL_API_KEY || "").length < 24) {
    errors.push("INTERNAL_API_KEY must be at least 24 characters.");
  }

  return { ok: errors.length === 0, errors };
}

async function isPathGitignored(relativeOut, gitignorePath) {
  const content = await fs.readFile(gitignorePath, "utf8").catch(() => "");
  const base = path.basename(relativeOut);
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  let ignored = false;

  for (const pattern of lines) {
    const negate = pattern.startsWith("!");
    const raw = negate ? pattern.slice(1) : pattern;
    const matches =
      raw === relativeOut ||
      raw === base ||
      (raw.endsWith("*") && relativeOut.startsWith(raw.slice(0, -1))) ||
      (raw === ".env.*" && /^\.env\..+/.test(base)) ||
      (raw === "!.env.*.example" && /^\.env\..+\.example$/.test(base));
    if (matches) ignored = !negate;
  }

  return ignored;
}

function isLocalDatabaseUrl(value = "") {
  if (value.startsWith("file:")) return true;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "postgres", "db"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isLocalRedisUrl(value = "") {
  try {
    const url = new URL(value);
    return (url.protocol === "redis:" || url.protocol === "rediss:") && ["localhost", "127.0.0.1", "redis"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHttpUrl(value = "") {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function redactPath(filePath) {
  return normalizePath(path.relative(root, filePath)) || path.basename(filePath);
}

export function formatSummary(summary) {
  return [
    "Generated local staging env.",
    `Output: ${summary.outputPath}`,
    `Generated secret keys: ${summary.generatedKeysCount}`,
    `Copied placeholder keys: ${summary.copiedPlaceholderKeysCount}`,
    `Next: ${summary.nextCommand}`
  ].join("\n");
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const summary = await generateStagingEnv(options);
    console.log(formatSummary(summary));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
