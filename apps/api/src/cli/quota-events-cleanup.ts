import { cleanupWorkspaceQuotaEvents } from "../services/workspaceQuotaCleanupService.js";
import { env } from "../config/env.js";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log(`Starting workspace quota event cleanup (dryRun: ${dryRun})...`);
  console.log(`Retention days: ${env.WORKSPACE_QUOTA_EVENT_RETENTION_DAYS}`);
  console.log(`Batch size: ${env.WORKSPACE_QUOTA_EVENT_CLEANUP_BATCH_SIZE}`);

  try {
    const result = await cleanupWorkspaceQuotaEvents({ dryRun });
    console.log("Cleanup completed successfully.");
    console.log(`- Cutoff date: ${result.cutoff}`);
    console.log(`- Events scanned: ${result.scanned}`);
    console.log(`- Events deleted: ${result.deleted}`);
    
    if (dryRun) {
      console.log("\n(Dry run complete. No events were actually deleted.)");
    }
    
    process.exit(0);
  } catch (err: any) {
    console.error("Cleanup failed:", err.message || err);
    process.exit(1);
  }
}

void main();
