import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../prisma.js";
import { 
  recordHealthObservation, 
  resolveIncident, 
  linkNotificationEvents,
  listProviderHealthIncidents
} from "../providerHealthIncidentService.js";
import { makeTestRunId, withTestUserScope, cleanupTestUserData } from "../../test/testIsolation.js";
import type { ProviderHealth } from "../providerHealthService.js";

const runId = makeTestRunId("incidentService");

describe("providerHealthIncidentService", () => {
  let userId: string;

  beforeEach(async () => {
    const scope = await withTestUserScope(runId);
    userId = scope.userId;
    await prisma.user.create({
      data: {
        id: userId,
        email: scope.email
      }
    });
  });

  afterEach(async () => {
    await cleanupTestUserData(userId);
  });

  it("should create a new incident when provider is unusable", async () => {
    const health: ProviderHealth = {
      provider: "chatgpt",
      displayName: "ChatGPT",
      readiness: "ready",
      capabilities: ["send_message"],
      connectionStatus: "requires_login",
      healthStatus: "requires_login",
      requiresLogin: true,
      isUsable: false,
      errorCode: "SESSION_EXPIRED",
      errorMessage: "Login needed"
    };

    const incident = await recordHealthObservation(userId, health, { source: "test" });
    expect(incident).toBeDefined();
    expect(incident?.provider).toBe("chatgpt");
    expect(incident?.status).toBe("requires_login");
    expect(incident?.severity).toBe("warning");
    expect(incident?.occurrenceCount).toBe(1);
    expect(incident?.resolvedAt).toBeNull();
    
    const parsedMeta = JSON.parse(incident!.metadata!);
    expect(parsedMeta.source).toBe("test");
  });

  it("should increment occurrence count on repeated identical unhealthy observations", async () => {
    const health: ProviderHealth = {
      provider: "chatgpt",
      displayName: "ChatGPT",
      readiness: "ready",
      capabilities: ["send_message"],
      connectionStatus: "error",
      healthStatus: "error",
      requiresLogin: false,
      isUsable: false,
      errorCode: "TIMEOUT"
    };

    const inc1 = await recordHealthObservation(userId, health);
    const inc2 = await recordHealthObservation(userId, health);

    expect(inc2?.id).toBe(inc1?.id);
    expect(inc2?.occurrenceCount).toBe(2);
    expect(inc2?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(inc1!.lastSeenAt.getTime());
  });

  it("should resolve existing incident when provider becomes usable", async () => {
    const unhealthy: ProviderHealth = {
      provider: "gemini",
      displayName: "Gemini",
      readiness: "ready",
      capabilities: ["send_message"],
      connectionStatus: "error",
      healthStatus: "error",
      requiresLogin: false,
      isUsable: false
    };

    await recordHealthObservation(userId, unhealthy);

    const healthy: ProviderHealth = {
      provider: "gemini",
      displayName: "Gemini",
      readiness: "ready",
      capabilities: ["send_message"],
      connectionStatus: "connected",
      healthStatus: "healthy",
      requiresLogin: false,
      isUsable: true
    };

    await recordHealthObservation(userId, healthy);

    const incidents = await listProviderHealthIncidents(userId, { provider: "gemini" });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].resolvedAt).not.toBeNull();
  });

  it("should resolve incident manually without fixing health", async () => {
    const health: ProviderHealth = {
      provider: "claude",
      displayName: "Claude",
      readiness: "ready",
      capabilities: ["send_message"],
      connectionStatus: "requires_login",
      healthStatus: "requires_login",
      requiresLogin: true,
      isUsable: false
    };

    const inc = await recordHealthObservation(userId, health);
    
    await resolveIncident(userId, inc!.id, "ignored", "I know it's broken");

    const updated = await prisma.providerHealthIncident.findUnique({ where: { id: inc!.id } });
    expect(updated?.resolvedAt).not.toBeNull();
    const meta = JSON.parse(updated!.metadata!);
    expect(meta.resolution).toBe("ignored");
    expect(meta.resolutionNote).toBe("I know it's broken");
  });

  it("should link notification event to an open incident", async () => {
    const health: ProviderHealth = {
      provider: "chatgpt",
      displayName: "ChatGPT",
      readiness: "ready",
      capabilities: ["send_message"],
      connectionStatus: "requires_login",
      healthStatus: "requires_login",
      requiresLogin: true,
      isUsable: false
    };

    const inc = await recordHealthObservation(userId, health);

    await linkNotificationEvents(userId, [
      {
        id: "evt_123",
        provider: "chatgpt",
        kind: "provider_requires_login",
        severity: "warning",
        title: "Test",
        message: "Test",
        createdAt: new Date().toISOString(),
        fingerprint: "test"
      }
    ] as any[]);

    const updated = await prisma.providerHealthIncident.findUnique({ where: { id: inc!.id } });
    expect(updated?.notificationEventId).toBe("evt_123");
  });
});
