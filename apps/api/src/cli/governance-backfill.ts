import { prisma } from "../services/prisma.js";
import { ensureDefaultWorkspace } from "../services/workspaceService.js";

export async function backfillGovernance(dryRun: boolean) {
  console.log(`Starting Governance Backfill (dryRun: ${dryRun})`);

  let usersUpdated = 0;
  let membershipsCreated = 0;
  let quotasCreated = 0;

  // 1. Get or create default workspace (simulate for dryRun)
  let defaultWsObj = await prisma.workspace.findUnique({
    where: { slug: "local" },
    select: { id: true }
  });
  
  if (!defaultWsObj) {
    if (!dryRun) {
      defaultWsObj = await ensureDefaultWorkspace();
    } else {
      defaultWsObj = { id: "dry-run-local-ws" };
    }
  }

  const defaultWsId = defaultWsObj.id;
  console.log(`Default Workspace ID: ${defaultWsId}`);

  // 2. Find users without workspaceId and assign them
  const orphanedUsers = await prisma.user.findMany({
    where: { workspaceId: null }
  });

  if (orphanedUsers.length > 0) {
    console.log(`Found ${orphanedUsers.length} users missing workspaceId.`);
    if (!dryRun) {
      await prisma.user.updateMany({
        where: { workspaceId: null },
        data: { workspaceId: defaultWsId }
      });
      usersUpdated += orphanedUsers.length;
    }
  }

  // 3. Find users without WorkspaceMembership
  const usersWithoutMembership = await prisma.user.findMany({
    where: {
      memberships: { none: {} }
    }
  });

  for (const user of usersWithoutMembership) {
    let targetWsId = user.workspaceId || defaultWsId;
    if (targetWsId !== defaultWsId) {
      const wsExists = await prisma.workspace.findUnique({ where: { id: targetWsId }, select: { id: true } });
      if (!wsExists) {
        targetWsId = defaultWsId;
      }
    }
    console.log(`Creating membership for user ${user.id} in workspace ${targetWsId}`);
    if (!dryRun) {
      await prisma.workspaceMembership.create({
        data: {
          workspaceId: targetWsId,
          userId: user.id,
          role: user.role || "member",
          status: "active"
        }
      });
      membershipsCreated++;
    }
  }

  // 4. Ensure all workspaces have a WorkspaceQuota
  const workspacesWithoutQuota = await prisma.workspace.findMany({
    where: { quota: null }
  });

  for (const ws of workspacesWithoutQuota) {
    console.log(`Creating default quota for workspace ${ws.id}`);
    if (!dryRun) {
      await prisma.workspaceQuota.create({
        data: {
          workspaceId: ws.id,
          plan: "local"
        }
      });
      quotasCreated++;
    }
  }

  console.log("--- Backfill Summary ---");
  console.log(`Users Updated (Workspace Assignment): ${orphanedUsers.length} (Dry Run: ${dryRun ? "Skipped" : usersUpdated})`);
  console.log(`Memberships Created: ${usersWithoutMembership.length} (Dry Run: ${dryRun ? "Skipped" : membershipsCreated})`);
  console.log(`Quotas Created: ${workspacesWithoutQuota.length} (Dry Run: ${dryRun ? "Skipped" : quotasCreated})`);
  console.log("------------------------");
}

import { fileURLToPath } from "url";

const isMain = typeof process !== 'undefined' && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain || process.argv[1]?.endsWith('governance-backfill.ts') || process.argv[1]?.endsWith('governance-backfill.js')) {
  const isDryRun = process.argv.includes("--dry-run");

  backfillGovernance(isDryRun)
    .then(() => {
      console.log("Governance backfill complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Error during governance backfill:", err);
      process.exit(1);
    });
}
