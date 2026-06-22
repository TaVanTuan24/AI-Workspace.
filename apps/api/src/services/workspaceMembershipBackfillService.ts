import { prisma } from "./prisma.js";

export async function runWorkspaceMembershipBackfill(dryRun: boolean = true) {
  console.log(`Starting workspace membership backfill... (Dry run: ${dryRun})`);

  const users = await prisma.user.findMany({
    select: { id: true, email: true, workspaceId: true, role: true }
  });

  console.log(`Found ${users.length} users to evaluate.`);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const user of users) {
    try {
      if (!user.workspaceId) {
        console.log(`Skipping user ${user.id} (${user.email}) - No workspaceId attached yet.`);
        skippedCount++;
        continue;
      }

      const existingMembership = await prisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: user.workspaceId,
            userId: user.id
          }
        }
      });

      if (existingMembership) {
        console.log(`Skipping user ${user.id} (${user.email}) - Membership already exists.`);
        skippedCount++;
        continue;
      }

      const roleToUse = user.role || "owner";

      console.log(`Creating membership for user ${user.id} (${user.email}) -> Workspace ${user.workspaceId} (Role: ${roleToUse})`);

      if (!dryRun) {
        await prisma.workspaceMembership.create({
          data: {
            workspaceId: user.workspaceId,
            userId: user.id,
            role: roleToUse,
            status: "active"
          }
        });
      }
      createdCount++;
    } catch (error) {
      console.error(`Error processing user ${user.id}:`, error);
      errorCount++;
    }
  }

  console.log(`\nBackfill complete!`);
  console.log(`Created: ${createdCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors:  ${errorCount}`);

  return { createdCount, skippedCount, errorCount };
}
