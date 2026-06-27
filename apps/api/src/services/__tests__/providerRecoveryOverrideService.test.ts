import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../prisma.js";
import { withTestUserScope } from "../../test/testIsolation.js";
import {
  createRecoveryOverride,
  expireOverrides,
  getEffectiveRecoveryState,
  isOverrideCurrentlyActive,
  listActiveOverrides,
  listRecoveryOverrides,
  rollbackOverride
} from "../providerRecoveryOverrideService.js";

describe("providerRecoveryOverrideService", () => {
  const scope = withTestUserScope("recovery-override");
  const userId = scope.userId;
  const other = withTestUserScope("recovery-override-other");

  beforeEach(async () => {
    await scope.cleanup();
    await other.cleanup();
    await prisma.user.create({ data: { id: userId, email: scope.email } });
    await prisma.user.create({ data: { id: other.userId, email: other.email } });
  });

  afterEach(async () => {
    await scope.cleanup();
    await other.cleanup();
  });

  it("creates an active override with bounded duration", async () => {
    const override = await createRecoveryOverride({
      userId,
      actionType: "mark_provider_temporarily_degraded",
      provider: "chatgpt",
      durationMinutes: 30,
      reason: "Safe summary",
      overrideState: { mode: "avoid_if_possible" },
      previousState: { type: "virtual_override" }
    });

    expect(override.status).toBe("active");
    expect(override.provider).toBe("chatgpt");
    expect(new Date(override.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await expect(prisma.auditLog.count({ where: { userId, action: "provider_recovery_override_created" } })).resolves.toBe(1);
  });

  it("rejects unsafe duration and unsafe JSON keys", async () => {
    await expect(createRecoveryOverride({
      userId,
      actionType: "disable_model_temporarily",
      modelId: "chatgpt-web",
      durationMinutes: 1,
      overrideState: {}
    })).rejects.toThrow(/duration/);

    await expect(createRecoveryOverride({
      userId,
      actionType: "disable_model_temporarily",
      modelId: "chatgpt-web",
      durationMinutes: 30,
      overrideState: { storageState: "raw" } as any
    })).rejects.toThrow(/Unsafe override metadata key/);
  });

  it("supersedes duplicate active overrides", async () => {
    const first = await createRecoveryOverride({
      userId,
      actionType: "disable_model_temporarily",
      provider: "chatgpt",
      modelId: "chatgpt-web",
      durationMinutes: 30,
      overrideState: { modelId: "chatgpt-web" }
    });
    const second = await createRecoveryOverride({
      userId,
      actionType: "disable_model_temporarily",
      provider: "chatgpt",
      modelId: "chatgpt-web",
      durationMinutes: 60,
      overrideState: { modelId: "chatgpt-web" }
    });

    const firstRaw = await prisma.providerRecoveryOverride.findUniqueOrThrow({ where: { id: first.id } });
    expect(firstRaw.status).toBe("superseded");
    expect(second.status).toBe("active");
    await expect(listActiveOverrides({ userId })).resolves.toHaveLength(1);
  });

  it("rolls back and expires overrides without provider calls", async () => {
    const override = await createRecoveryOverride({
      userId,
      actionType: "prefer_fallback_provider",
      provider: "chatgpt",
      durationMinutes: 30,
      overrideState: { fallbackProviderOrder: ["gemini"], onlyIfProvider: "chatgpt" }
    });

    const rolledBack = await rollbackOverride({ userId, overrideId: override.id, resolution: "manual_rollback" });
    expect(rolledBack?.status).toBe("rolled_back");

    const expiredCandidate = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        actionType: "disable_model_temporarily",
        modelId: "claude-web",
        status: "active",
        overrideState: JSON.stringify({ modelId: "claude-web" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1_000)
      }
    });

    const expired = await expireOverrides({ userId });
    expect(expired.scanned).toBe(1);
    expect(expired.expired).toBe(1);
    expect(expired.expiredOverrides.map((item) => item.id)).toContain(expiredCandidate.id);
    const raw = await prisma.providerRecoveryOverride.findUniqueOrThrow({ where: { id: expiredCandidate.id } });
    expect(raw.status).toBe("expired");
  });

  it("does not expire future or rolled back overrides and respects limit", async () => {
    const now = new Date();
    const future = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        actionType: "disable_model_temporarily",
        modelId: "future-model",
        status: "active",
        overrideState: JSON.stringify({ modelId: "future-model" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: now,
        expiresAt: new Date(now.getTime() + 60_000)
      }
    });
    const rolledBack = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        actionType: "disable_model_temporarily",
        modelId: "rolled-back-model",
        status: "rolled_back",
        overrideState: JSON.stringify({ modelId: "rolled-back-model" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() - 60_000),
        resolvedAt: new Date(now.getTime() - 30_000),
        resolution: "manual_rollback"
      }
    });
    const dueOne = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        actionType: "disable_model_temporarily",
        modelId: "due-one",
        status: "active",
        overrideState: JSON.stringify({ modelId: "due-one" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() - 50_000)
      }
    });
    const dueTwo = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        actionType: "disable_model_temporarily",
        modelId: "due-two",
        status: "active",
        overrideState: JSON.stringify({ modelId: "due-two" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() - 40_000)
      }
    });

    const result = await expireOverrides({ userId, now, limit: 1 });
    expect(result.scanned).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.expiredOverrides[0].id).toBe(dueOne.id);

    await expect(prisma.providerRecoveryOverride.findUniqueOrThrow({ where: { id: future.id } })).resolves.toMatchObject({ status: "active" });
    await expect(prisma.providerRecoveryOverride.findUniqueOrThrow({ where: { id: rolledBack.id } })).resolves.toMatchObject({ status: "rolled_back" });
    await expect(prisma.providerRecoveryOverride.findUniqueOrThrow({ where: { id: dueTwo.id } })).resolves.toMatchObject({ status: "active" });
  });

  it("treats past-due active overrides as ineffective before scheduler cleanup", async () => {
    const now = new Date();
    const due = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        actionType: "disable_model_temporarily",
        provider: "gemini",
        modelId: "gemini-web",
        status: "active",
        overrideState: JSON.stringify({ modelId: "gemini-web" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() - 60_000)
      }
    });

    expect(isOverrideCurrentlyActive({ status: "active", expiresAt: due.expiresAt.toISOString() }, now)).toBe(false);
    await expect(listActiveOverrides({ userId, now })).resolves.toHaveLength(0);
    const state = await getEffectiveRecoveryState(userId);
    expect(state.temporarilyDisabledModels["gemini-web|gemini|*"]).toBeUndefined();
  });

  it("lists current user only and builds effective state", async () => {
    await createRecoveryOverride({
      userId,
      actionType: "mark_provider_temporarily_degraded",
      provider: "gemini",
      durationMinutes: 30,
      overrideState: { mode: "block_for_duration" }
    });
    await createRecoveryOverride({
      userId: other.userId,
      actionType: "mark_provider_temporarily_degraded",
      provider: "claude",
      durationMinutes: 30,
      overrideState: { mode: "avoid_if_possible" }
    });

    const list = await listRecoveryOverrides({ userId, status: "active" });
    expect(list).toHaveLength(1);
    expect(list[0].provider).toBe("gemini");

    const state = await getEffectiveRecoveryState(userId);
    expect(state.degradedProviders.gemini.mode).toBe("block_for_duration");
    expect(state.degradedProviders.claude).toBeUndefined();
  });
});
