#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const root = process.cwd();
const apiPort = Number(args.apiPort ?? await getFreePort());
const redisPort = Number(args.redisPort ?? (args.useExistingRedis ? 6379 : await getFreePort()));
const dbName = `ci-smoke-${Date.now()}-${process.pid}.db`;
const databaseUrl = `file:./${dbName}`;
const dbFiles = [
  path.join(root, "prisma", dbName),
  path.join(root, "prisma", `${dbName}-journal`)
];

let apiProcess;
let redisContainerId;

const redisUrl = args.redisUrl ?? `redis://127.0.0.1:${redisPort}`;
const smokeEnv = {
  ...process.env,
  NODE_ENV: "production",
  LOG_LEVEL: "warn",
  API_PORT: String(apiPort),
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  SESSION_MASTER_KEY: crypto.randomBytes(32).toString("base64"),
  SESSION_MASTER_KEY_ID: "ci-smoke-v1",
  ENABLE_DB_API_KEYS: "true",
  API_KEY_HASH_SECRET: crypto.randomBytes(32).toString("base64url"),
  PROVIDER_HEALTH_SCHEDULER_ENABLED: "false",
  INTERNAL_API_RATE_LIMIT_PER_MINUTE: "30",
  INTERNAL_API_RATE_LIMIT_MAX_PER_MINUTE: "300",
  BROWSER_HEADLESS: "true",
  LOCAL_SINGLE_USER_MODE: "true",
  SHUTDOWN_TIMEOUT_MS: "5000"
};

try {
  if (!args.useExistingRedis) {
    redisContainerId = startRedis(redisPort);
  }

  await waitForTcp("127.0.0.1", redisPort, 20_000);
  await run("corepack", ["pnpm", "exec", "prisma", "generate"], smokeEnv);
  await run("corepack", ["pnpm", "exec", "prisma", "db", "push", "--skip-generate"], smokeEnv);
  await run("corepack", ["pnpm", "--filter", "@uaiw/api...", "build"], smokeEnv);

  apiProcess = startApi(smokeEnv);
  await pollHttp(`http://127.0.0.1:${apiPort}/health`, 200, 30_000);
  await pollHttp(`http://127.0.0.1:${apiPort}/ready`, 200, 30_000);

  console.log("[ci:smoke-ready] /health and /ready returned 200.");
} finally {
  await cleanup();
}

function parseArgs(argv) {
  const parsed = {
    useExistingRedis: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--use-existing-redis") {
      parsed.useExistingRedis = true;
    } else if (arg === "--redis-url") {
      parsed.redisUrl = argv[++index];
    } else if (arg === "--redis-port") {
      parsed.redisPort = argv[++index];
    } else if (arg === "--api-port") {
      parsed.apiPort = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.redisUrl && parsed.redisPort) {
    throw new Error("Use either --redis-url or --redis-port, not both.");
  }

  if (parsed.redisUrl) {
    const url = new URL(parsed.redisUrl);
    parsed.redisPort = url.port || "6379";
  }

  return parsed;
}

function startRedis(port) {
  console.log(`[ci:smoke-ready] Starting ephemeral Redis on 127.0.0.1:${port}.`);
  const result = spawnSync(
    "docker",
    ["run", "--rm", "-d", "-p", `127.0.0.1:${port}:6379`, "redis:7-alpine"],
    {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32"
    }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "Docker Redis startup failed.";
    throw new Error(`${stderr}\nDocker is required unless --use-existing-redis is provided.`);
  }

  return result.stdout.trim();
}

function startApi(env) {
  console.log(`[ci:smoke-ready] Starting API on 127.0.0.1:${env.API_PORT}.`);
  const child = spawn("node", ["apps/api/dist/server.js"], {
    cwd: root,
    env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = [];
  child.stdout.on("data", (chunk) => collectOutput(output, chunk));
  child.stderr.on("data", (chunk) => collectOutput(output, chunk));
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[ci:smoke-ready] API exited early with code ${code}${signal ? ` signal ${signal}` : ""}.`);
      printLastOutput(output);
    }
  });

  child.recentOutput = output;
  return child;
}

function run(command, commandArgs, env) {
  const printable = [command, ...commandArgs].join(" ");
  console.log(`[ci:smoke-ready] ${printable}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env,
      shell: process.platform === "win32",
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${printable} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

async function pollHttp(url, expectedStatus, timeoutMs) {
  const startedAt = Date.now();
  let lastStatus = 0;
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    if (apiProcess?.exitCode !== null) {
      printLastOutput(apiProcess.recentOutput ?? []);
      throw new Error(`API exited before ${url} became ready.`);
    }

    try {
      const response = await fetch(url);
      lastStatus = response.status;
      if (response.status === expectedStatus) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }

  printLastOutput(apiProcess?.recentOutput ?? []);
  throw new Error(`${url} did not return ${expectedStatus}. Last status=${lastStatus || "none"} ${lastError}`);
}

function waitForTcp(host, port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for Redis at ${host}:${port}.`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate a free port."));
        }
      });
    });
    server.on("error", reject);
  });
}

async function cleanup() {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await waitForExit(apiProcess, 5_000).catch(() => {
      apiProcess.kill("SIGKILL");
    });
  }

  if (redisContainerId) {
    spawnSync("docker", ["rm", "-f", redisContainerId], {
      cwd: root,
      stdio: "ignore",
      shell: process.platform === "win32"
    });
  }

  for (const file of dbFiles) {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Process did not exit in time.")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function collectOutput(output, chunk) {
  output.push(chunk.toString("utf8"));
  if (output.length > 80) output.splice(0, output.length - 80);
}

function printLastOutput(output) {
  if (!output.length) return;
  console.error("[ci:smoke-ready] Last API output:");
  console.error(output.join("").split("\n").slice(-40).join("\n"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
