#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipDocker = args.has("--skip-docker");

const commands = [
  ["corepack", ["pnpm", "install", "--frozen-lockfile"]],
  ["corepack", ["pnpm", "exec", "prisma", "generate"]],
  ["corepack", ["pnpm", "exec", "prisma", "validate"]],
  ["corepack", ["pnpm", "typecheck"]],
  ["corepack", ["pnpm", "test:isolation"]],
  ["corepack", ["pnpm", "test"]],
  ["corepack", ["pnpm", "--filter", "@uaiw/api...", "build"]],
  ["corepack", ["pnpm", "--filter", "@uaiw/worker...", "build"]],
  ["corepack", ["pnpm", "--filter", "@uaiw/web...", "build"]]
];

if (!skipDocker) {
  commands.push(["docker", ["compose", "config"]]);
}

for (const [command, commandArgs] of commands) {
  await run(command, commandArgs);
}

if (skipDocker) {
  console.log("\n[ci] Docker checks skipped by --skip-docker.");
}

console.log("\n[ci] Checks completed.");

function run(command, commandArgs) {
  const printable = [command, ...commandArgs].join(" ");
  console.log(`\n[ci] ${printable}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? "test"
      },
      shell: process.platform === "win32",
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (commandArgs.includes("test:isolation")) {
        console.error(`\n💥 Test isolation guardrail failed.`);
        console.error(`Run: pnpm test:isolation`);
        console.error(`Use scoped cleanup helpers instead of global DB mutation.\n`);
      }
      reject(new Error(`${printable} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}
