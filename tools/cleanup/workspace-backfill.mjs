#!/usr/bin/env node

import { backfillWorkspaceIds } from "../../apps/api/src/services/workspaceBackfillService.ts";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log(`Starting workspaceId backfill... ${dryRun ? "(DRY RUN)" : ""}`);

  try {
    const summary = await backfillWorkspaceIds({ dryRun });
    console.log("Backfill completed safely.");
    console.log("Summary:");
    console.log(JSON.stringify(summary, null, 2));

    if (summary.unresolved > 0) {
      console.warn(`WARNING: ${summary.unresolved} records could not be resolved. They remain un-scoped.`);
    }
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
}

main();
