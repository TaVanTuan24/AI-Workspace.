#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs() {
  const args = process.argv.slice(2);
  let isStrict = false;
  let auditFailOn = "critical";
  let licenseFailOn = "denied";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--strict") {
      isStrict = true;
      auditFailOn = "high";
      licenseFailOn = "review";
    } else if (args[i] === "--audit-fail-on" && args[i + 1]) {
      auditFailOn = args[++i];
    } else if (args[i] === "--license-fail-on" && args[i + 1]) {
      licenseFailOn = args[++i];
    }
  }

  return { isStrict, auditFailOn, licenseFailOn };
}

async function run() {
  const { isStrict, auditFailOn, licenseFailOn } = parseArgs();
  console.log(`Starting unified security scan (strict: ${isStrict})`);

  let auditFailed = false;
  let licenseFailed = false;
  const failures = [];

  // Run audit
  try {
    execSync(`corepack pnpm security:audit --fail-on ${auditFailOn}`, { stdio: "inherit" });
  } catch {
    auditFailed = true;
    failures.push("audit");
  }

  // Run licenses
  try {
    execSync(`corepack pnpm security:licenses --fail-on ${licenseFailOn}`, { stdio: "inherit" });
  } catch {
    licenseFailed = true;
    failures.push("licenses");
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    auditReport: "dist-security/vulnerability-audit.json",
    licenseReport: "dist-security/license-report.json",
    result: (auditFailed || licenseFailed) ? "fail" : "pass",
    failures
  };

  const outPath = "dist-security/security-summary.json";
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(`\n--- Unified Security Scan Result ---`);
  console.log(`Result: ${report.result.toUpperCase()}`);
  if (failures.length > 0) {
    console.error(`Failures: ${failures.join(", ")}`);
  }
  console.log(`Summary written to: ${outPath}`);

  if (auditFailed || licenseFailed) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
