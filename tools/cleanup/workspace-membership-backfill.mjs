import "tsx/cli";
import { runWorkspaceMembershipBackfill } from "../../apps/api/src/services/workspaceMembershipBackfillService.ts";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (dryRun) {
    console.log("=== RUNNING IN DRY RUN MODE ===");
  } else {
    console.log("=== RUNNING IN LIVE MODE ===");
  }

  await runWorkspaceMembershipBackfill(dryRun);
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal backfill error:", error);
  process.exit(1);
});
