import { deleteOldNotificationEvents } from "../../../apps/api/src/services/notificationEventService.js";

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let jsonOutput = false;
  let olderThanDays: number | undefined = undefined;
  let beforeDate: Date | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--older-than-days") {
      if (i + 1 < args.length) {
        olderThanDays = parseInt(args[++i], 10);
        if (isNaN(olderThanDays)) {
          console.error("Invalid value for --older-than-days");
          process.exit(2);
        }
      } else {
        console.error("Missing value for --older-than-days");
        process.exit(2);
      }
    } else if (arg === "--before") {
      if (i + 1 < args.length) {
        beforeDate = new Date(args[++i]);
        if (isNaN(beforeDate.getTime())) {
          console.error("Invalid date value for --before");
          process.exit(2);
        }
      } else {
        console.error("Missing value for --before");
        process.exit(2);
      }
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  try {
    const result = await deleteOldNotificationEvents({
      dryRun,
      olderThanDays,
      before: beforeDate
    });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Notification Event Cleanup\n");
      console.log(`Dry run: ${result.dryRun}`);
      console.log(`Cutoff date: ${result.cutoffDate}`);
      console.log(`Matched events: ${result.matchedCount}`);
      console.log(`Deleted events: ${result.deletedCount}`);
    }
    process.exit(0);
  } catch (error: any) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: error.message }, null, 2));
    } else {
      console.error(`Error during cleanup: ${error.message}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
