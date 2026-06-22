import { providerHealthScheduler } from "../../../apps/api/src/services/providerHealthScheduler.js";
import { prisma } from "../../../apps/api/src/services/prisma.js";
import { chatQueueConnection } from "../../../apps/api/src/services/chatQueue.js";

async function main() {
  const isJson = process.argv.includes("--json");

  try {
    const result = await providerHealthScheduler.runOnce("manual");
    
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Provider Health Scheduler Run Result:");
      console.log("-------------------------------------");
      console.log(`Started At:          ${result.startedAt}`);
      console.log(`Finished At:         ${result.finishedAt}`);
      console.log(`Duration:            ${result.durationMs}ms`);
      console.log(`Checked Users:       ${result.checkedUsers}`);
      console.log(`Checked Connections: ${result.checkedConnections}`);
      console.log(`Healthy:             ${result.healthy}`);
      console.log(`Requires Login:      ${result.requiresLogin}`);
      console.log(`Errors:              ${result.errors}`);
      console.log(`Skipped:             ${result.skipped}`);
      console.log("-------------------------------------");
    }
  } catch (err) {
    if (isJson) {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } else {
      console.error("Failed to run provider health scheduler:", err);
    }
    process.exit(1);
  } finally {
    // Close connections to allow script to exit
    await prisma.$disconnect();
    chatQueueConnection.disconnect();
    process.exit(0);
  }
}

main();
