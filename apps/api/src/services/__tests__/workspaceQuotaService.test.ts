import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../prisma.js';
import {
  getOrCreateWorkspaceQuota,
  getWorkspaceUsageSummary,
  checkWorkspaceQuota,
  assertWorkspaceQuota,
  updateWorkspaceQuota,
} from '../workspaceQuotaService.js';
import { SafeError } from '../safeProviderError.js';

describe('workspaceQuotaService', () => {
  let user: any;
  let workspace: any;

  beforeEach(async () => {
    user = await prisma.user.create({
      data: { email: `test-${Date.now()}@example.com`, role: 'owner' },
    });
    workspace = await prisma.workspace.create({
      data: { name: 'Test Quota WS', slug: `test-quota-${Date.now()}` },
    });
  });

  it('creates default quota lazily', async () => {
    const quota = await getOrCreateWorkspaceQuota(workspace.id);
    expect(quota.workspaceId).toBe(workspace.id);
    expect(quota.plan).toBe('local');
    expect(quota.maxMembers).toBeNull(); // unlimited default
  });

  it('returns valid usage summary', async () => {
    const summary = await getWorkspaceUsageSummary({ workspaceId: workspace.id });
    expect(summary.plan).toBe('local');
    const membersStatus = summary.quotas.find((q: any) => q.resource === 'members');
    expect(membersStatus).toBeDefined();
    expect(membersStatus?.limit).toBeNull();
    expect(membersStatus?.used).toBe(0);
    expect(membersStatus?.exceeded).toBe(false);
  });

  it('checks quota logic properly', async () => {
    await updateWorkspaceQuota({
      workspaceId: workspace.id,
      patch: { maxApiKeys: 1 },
    });

    const check1 = await checkWorkspaceQuota({
      workspaceId: workspace.id,
      resource: 'apiKeys',
      incrementBy: 1,
    });
    expect(check1.exceeded).toBe(false);

    const check2 = await checkWorkspaceQuota({
      workspaceId: workspace.id,
      resource: 'apiKeys',
      incrementBy: 2,
    });
    expect(check2.exceeded).toBe(true);
  });

  it('asserts quota safely', async () => {
    await updateWorkspaceQuota({
      workspaceId: workspace.id,
      patch: { maxPendingInvites: 0 } as any, // bypassing type explicitly or use maxInvites
    });

    await updateWorkspaceQuota({
      workspaceId: workspace.id,
      patch: { maxInvites: 0 },
    });

    await expect(
      assertWorkspaceQuota({
        workspaceId: workspace.id,
        resource: 'pendingInvites',
        incrementBy: 1,
      })
    ).rejects.toThrowError(SafeError);
  });
});
