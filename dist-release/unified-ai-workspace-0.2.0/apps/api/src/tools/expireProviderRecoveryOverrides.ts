import { expireOverrides } from "../services/providerRecoveryOverrideService.js";
import { prisma } from "../services/prisma.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

try {
  const result = await expireOverrides({ dryRun, limit });
  console.log(JSON.stringify({
    command: "provider-recovery-overrides:expire",
    dryRun: result.dryRun,
    scanned: result.scanned,
    expiredCount: result.expired,
    skipped: result.skipped,
    overrideIds: result.expiredOverrides.map((override) => override.id)
  }));
} catch (error) {
  console.error(JSON.stringify({
    command: "provider-recovery-overrides:expire",
    status: "failed",
    message: error instanceof Error ? error.message : "Unknown error"
  }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
