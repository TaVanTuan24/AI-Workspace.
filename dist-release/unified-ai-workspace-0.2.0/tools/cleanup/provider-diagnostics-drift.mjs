import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BASELINE_RETENTION_DAYS = parseInt(process.env.PROVIDER_DIAGNOSTICS_BASELINE_RETENTION_DAYS || "365", 10);
const ALERT_RETENTION_DAYS = parseInt(process.env.PROVIDER_DIAGNOSTICS_DRIFT_ALERT_RETENTION_DAYS || "180", 10);
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`Starting Provider Diagnostics Drift Cleanup...`);
  console.log(`- Dry run: ${DRY_RUN}`);
  console.log(`- Baseline retention: ${BASELINE_RETENTION_DAYS} days`);
  console.log(`- Resolved alert retention: ${ALERT_RETENTION_DAYS} days`);

  const baselineCutoff = new Date(Date.now() - BASELINE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const alertCutoff = new Date(Date.now() - ALERT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // 1. Delete old resolved alerts
  const oldAlerts = await prisma.providerDiagnosticsDriftAlert.findMany({
    where: {
      status: "resolved",
      resolvedAt: { lt: alertCutoff }
    },
    select: { id: true }
  });

  console.log(`Found ${oldAlerts.length} old resolved alerts to delete.`);
  if (!DRY_RUN && oldAlerts.length > 0) {
    const res = await prisma.providerDiagnosticsDriftAlert.deleteMany({
      where: {
        id: { in: oldAlerts.map(a => a.id) }
      }
    });
    console.log(`Deleted ${res.count} old alerts.`);
  }

  // 2. Delete old inactive baselines (only if not referenced by any open alerts)
  // We'll delete them if they have no alerts referencing them, or if all referencing alerts are deleted above.
  const oldBaselines = await prisma.providerDiagnosticsBaseline.findMany({
    where: {
      isActive: false,
      createdAt: { lt: baselineCutoff }
    },
    select: { id: true }
  });

  let deletedBaselinesCount = 0;
  for (const baseline of oldBaselines) {
    const alertsCount = await prisma.providerDiagnosticsDriftAlert.count({
      where: { baselineId: baseline.id }
    });

    if (alertsCount === 0) {
      if (!DRY_RUN) {
        await prisma.providerDiagnosticsBaseline.delete({ where: { id: baseline.id } });
      }
      deletedBaselinesCount++;
    }
  }

  console.log(`Found ${oldBaselines.length} old inactive baselines, can safely delete ${deletedBaselinesCount}.`);
  if (!DRY_RUN && deletedBaselinesCount > 0) {
    console.log(`Deleted ${deletedBaselinesCount} old baselines.`);
  }

  console.log("Cleanup complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
