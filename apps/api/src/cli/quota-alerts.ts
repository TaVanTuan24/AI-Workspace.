import { workspaceQuotaAlertScheduler } from "../services/workspaceQuotaAlertScheduler.js";
import { chatQueueConnection } from "../services/chatQueue.js";
import { prisma } from "../services/prisma.js";

async function run() {
  const isDryRun = process.argv.includes("--dry-run");
  if (!isDryRun) {
    console.warn("WARNING: Running without --dry-run.");
  }

  try {
    const result = await workspaceQuotaAlertScheduler.runOnce("manual");
    
    console.log("Workspace quota alert scheduler run completed:");
    console.log(JSON.stringify({
      durationMs: result.durationMs,
      scannedWorkspaces: result.scannedWorkspaces,
      warningsCreated: result.warningsCreated,
      exceededCreated: result.exceededCreated,
      skipped: result.skipped,
      errors: result.errors,
      lockAcquired: result.lockAcquired,
      lockMode: result.lockMode
    }, null, 2));

    if (result.errors > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Workspace quota alert scheduler run failed:", err);
    process.exit(1);
  } finally {
    try {
      chatQueueConnection.disconnect();
    } catch {}
    try {
      await prisma.$disconnect();
    } catch {}
  }
}

run();
