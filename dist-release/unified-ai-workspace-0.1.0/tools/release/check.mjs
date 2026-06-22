#!/usr/bin/env node
import path from "node:path";
import {
  forbiddenPackagePatterns,
  getReleaseInfo,
  isValidSemver,
  pathExists,
  root,
  shouldExclude
} from "./lib.mjs";

const json = process.argv.includes("--json");
const requiredPaths = [
  "README.md",
  ".env.example",
  "docker-compose.yml",
  "docker/api.Dockerfile",
  "docker/worker.Dockerfile",
  "docker/web.Dockerfile",
  "prisma/schema.prisma",
  ".github/workflows/ci.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml"
];

const releaseInfo = await getReleaseInfo();
const checks = [];

checks.push(check("package version is valid semver", isValidSemver(releaseInfo.packageVersion)));
checks.push(check("release version is valid semver", isValidSemver(releaseInfo.version)));

for (const requiredPath of requiredPaths) {
  checks.push(check(`${requiredPath} exists`, await pathExists(requiredPath)));
}

checks.push(check("Prisma migrations exist", releaseInfo.migrations.length > 0));
checks.push(check(".env.example is allowed in package", !shouldExclude(".env.example")));
checks.push(check(".env is excluded from package", shouldExclude(".env")));
checks.push(check("SQLite DB files are excluded from package", shouldExclude("prisma/dev.db")));
checks.push(check("browser profiles are excluded from package", shouldExclude(".data/browser-profiles/local-user/gemini")));
checks.push(check("smoke reports are excluded from package", shouldExclude("var/smoke-reports/test.json")));
checks.push(check("node_modules are excluded from package", shouldExclude("node_modules/example")));

const forbiddenPolicy = forbiddenPackagePatterns.map((pattern) => pattern.toString());
const ok = checks.every((item) => item.ok);
const report = {
  ok,
  name: releaseInfo.name,
  version: releaseInfo.version,
  root: path.resolve(root),
  migrations: releaseInfo.migrations,
  dockerImages: releaseInfo.dockerImages,
  checks,
  forbiddenPackagePolicy: forbiddenPolicy
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Release check for ${releaseInfo.name} v${releaseInfo.version}`);
  for (const item of checks) {
    console.log(`${item.ok ? "OK" : "FAIL"} ${item.name}`);
  }
  console.log(`Migrations: ${releaseInfo.migrations.length}`);
  console.log(`Docker tags: ${Object.values(releaseInfo.dockerImages).join(", ")}`);
}

if (!ok) {
  process.exitCode = 1;
}

function check(name, ok) {
  return { name, ok: Boolean(ok) };
}
