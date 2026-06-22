#!/usr/bin/env node

import { parseArgs } from "node:util";
import { expireInvites } from "../services/workspaceInviteService.js";
import { prisma } from "../services/prisma.js";

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "dry-run": {
        type: "boolean",
        default: false
      }
    }
  });

  const isDryRun = !!values["dry-run"];
  
  if (isDryRun) {
    console.log("[Workspace Invites] Running in DRY-RUN mode. No changes will be saved.");
  }

  try {
    const result = await expireInvites({
      now: new Date(),
      limit: 5000,
      dryRun: isDryRun
    });

    console.log("[Workspace Invites] Expiry Summary:");
    console.log(`  Scanned: ${result.scanned}`);
    console.log(`  Expired: ${result.expired}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Dry Run: ${result.dryRun}`);
    
    process.exit(0);
  } catch (error) {
    console.error("[Workspace Invites] Fatal error during expiry run:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Unhandled rejection in expire-invites CLI:", err);
  process.exit(1);
});
