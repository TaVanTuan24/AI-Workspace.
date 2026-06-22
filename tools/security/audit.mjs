#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const SEVERITY_LEVELS = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4
};

function parseArgs() {
  const args = process.argv.slice(2);
  let minSeverity = "moderate";
  let failOn = "critical";
  let outPath = "dist-security/vulnerability-audit.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--min-severity" && args[i + 1]) minSeverity = args[++i];
    else if (args[i] === "--fail-on" && args[i + 1]) failOn = args[++i];
    else if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
  }

  return { minSeverity, failOn, outPath };
}

async function run() {
  const { minSeverity, failOn, outPath } = parseArgs();
  
  console.log(`Running pnpm audit... (fail-on: ${failOn}, min-severity: ${minSeverity})`);
  
  let rawOutput = "";
  try {
    rawOutput = execSync("corepack pnpm audit --json", { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (err) {
    // pnpm audit exits with non-zero if vulnerabilities are found
    rawOutput = err.stdout;
    if (!rawOutput) {
      console.error("Failed to run pnpm audit. Ensure you are in a pnpm workspace.");
      console.error(err.message);
      process.exit(1);
    }
  }

  let auditData;
  try {
    auditData = JSON.parse(rawOutput);
  } catch {
    console.error("Failed to parse pnpm audit JSON output");
    process.exit(1);
  }

  const minLevel = SEVERITY_LEVELS[minSeverity] ?? 2;
  const failLevel = SEVERITY_LEVELS[failOn] ?? 4;

  const summary = {
    total: 0,
    bySeverity: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  };

  const advisoriesList = [];
  let shouldFail = false;

  const advisories = auditData.advisories || {};
  for (const key of Object.keys(advisories)) {
    const adv = advisories[key];
    const sevString = adv.severity || "unknown";
    const sevLvl = SEVERITY_LEVELS[sevString] ?? 0;
    
    summary.bySeverity[sevString] = (summary.bySeverity[sevString] || 0) + 1;
    summary.total++;

    if (sevLvl >= minLevel) {
      const paths = adv.findings?.flatMap((f) => f.paths) || [];
      advisoriesList.push({
        id: adv.github_advisory_id || adv.cves?.[0] || String(adv.id),
        severity: sevString,
        packageName: adv.module_name,
        title: adv.title,
        url: adv.url,
        patchedVersions: adv.patched_versions,
        paths
      });
    }

    if (sevLvl >= failLevel) {
      shouldFail = true;
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tool: {
      name: "pnpm audit",
      version: "auto"
    },
    policy: { minSeverity, failOn },
    summary,
    advisories: advisoriesList
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("\n--- Audit Summary ---");
  console.log(`Total advisories: ${summary.total}`);
  console.log(`By severity:`, summary.bySeverity);
  console.log(`Report written to: ${outPath}`);

  if (shouldFail) {
    console.error(`\n❌ Vulnerability check failed. Found advisories with severity >= ${failOn}.`);
    process.exit(1);
  } else {
    console.log("\n✅ Vulnerability check passed.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
