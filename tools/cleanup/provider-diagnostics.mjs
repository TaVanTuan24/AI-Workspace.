import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const retentionDaysStr = process.env.PROVIDER_DIAGNOSTICS_RETENTION_DAYS || "90";
  const retentionDays = parseInt(retentionDaysStr, 10);

  if (isNaN(retentionDays) || retentionDays < 1) {
    console.error("Invalid PROVIDER_DIAGNOSTICS_RETENTION_DAYS. Must be a positive integer.");
    process.exit(1);
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  console.log(`Starting Provider Diagnostics History cleanup...`);
  console.log(`Retention: ${retentionDays} days (Older than: ${cutoffDate.toISOString()})`);
  if (dryRun) console.log(`[DRY RUN] No records will be deleted.`);

  try {
    const toDeleteCount = await prisma.providerDiagnosticsRun.count({
      where: {
        startedAt: {
          lt: cutoffDate
        }
      }
    });

    console.log(`Found ${toDeleteCount} diagnostic runs to delete.`);

    if (!dryRun && toDeleteCount > 0) {
      const result = await prisma.providerDiagnosticsRun.deleteMany({
        where: {
          startedAt: {
            lt: cutoffDate
          }
        }
      });
      console.log(`Successfully deleted ${result.count} runs.`);
    }

    console.log("Cleanup complete.");
  } catch (error) {
    console.error("Failed to cleanup diagnostics runs:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
