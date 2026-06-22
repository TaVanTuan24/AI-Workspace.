import { PrismaClient } from "@prisma/client";
import { env } from "../../apps/api/src/config/env.js";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const retentionDaysStr = process.env.PROVIDER_HEALTH_INCIDENT_RETENTION_DAYS || "180";
  const retentionDays = parseInt(retentionDaysStr, 10);

  if (isNaN(retentionDays) || retentionDays < 1) {
    console.error("Invalid PROVIDER_HEALTH_INCIDENT_RETENTION_DAYS. Must be a positive integer.");
    process.exit(1);
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  console.log(`Starting Provider Health Incident cleanup...`);
  console.log(`Retention: ${retentionDays} days (Older than: ${cutoffDate.toISOString()})`);
  if (dryRun) console.log(`[DRY RUN] No records will be deleted.`);

  try {
    const toDeleteCount = await prisma.providerHealthIncident.count({
      where: {
        resolvedAt: {
          not: null,
          lt: cutoffDate
        }
      }
    });

    console.log(`Found ${toDeleteCount} resolved incidents to delete.`);

    if (!dryRun && toDeleteCount > 0) {
      const result = await prisma.providerHealthIncident.deleteMany({
        where: {
          resolvedAt: {
            not: null,
            lt: cutoffDate
          }
        }
      });
      console.log(`Successfully deleted ${result.count} incidents.`);
    }

    console.log("Cleanup complete.");
  } catch (error) {
    console.error("Failed to cleanup incidents:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
