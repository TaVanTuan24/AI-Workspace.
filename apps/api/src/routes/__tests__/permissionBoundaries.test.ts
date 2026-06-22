import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeyRoutes } from "../apiKeys.js";
import { modelPreferenceRoutes } from "../modelPreferences.js";
import { notificationDeliveryRoutes } from "../notificationDelivery.js";
import { providerHealthRoutes } from "../providerHealth.js";
import { providerRateLimitRoutes } from "../providerRateLimits.js";
import { providerRecoveryPolicyRoutes } from "../providerRecoveryPolicies.js";
import { providerRoutes } from "../providers.js";

const state = vi.hoisted(() => ({
  role: "member",
  permissions: ["models.read"],
  auditCreate: vi.fn(),
  getModelPreferences: vi.fn()
}));

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: vi.fn(async (request: any) => {
    request.user = {
      id: "permission-test-user",
      email: "permission-test@example.com",
      role: state.role
    };
  })
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn(async (request: any) => {
    if (!request.user) return null;
    request.workspaceContext = {
      userId: request.user.id,
      workspaceId: "test-workspace-id",
      membershipId: "test-membership-id",
      role: request.user.role,
      permissions: state.permissions || []
    };
    return request.workspaceContext;
  }),
  requireWorkspaceContext: vi.fn(async (request: any, reply: any) => {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    request.workspaceContext = {
      userId: request.user.id,
      workspaceId: "test-workspace-id",
      membershipId: "test-membership-id",
      role: request.user.role,
      permissions: state.permissions || []
    };
    return request.workspaceContext;
  })
}));

vi.mock("../../services/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    auditLog: { create: state.auditCreate },
    providerConnection: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock("../../services/modelPreferenceService.js", () => ({
  getModelPreferences: state.getModelPreferences,
  updateModelPreferences: vi.fn()
}));

vi.mock("../../services/notificationWebhookRetryQueue.js", () => ({
  enqueueWebhookDeliveryRetry: vi.fn()
}));

vi.mock("../../services/providerRateLimitService.js", () => ({
  listProviderRateLimitSettings: vi.fn(),
  updateProviderRateLimitSetting: vi.fn()
}));

vi.mock("../../services/providerHealthService.js", () => ({
  getProviderHealth: vi.fn(),
  refreshProviderHealth: vi.fn(),
  refreshAllProviderHealth: vi.fn()
}));

vi.mock("../../services/browserManager.js", () => ({
  browserManager: {
    createLoginContext: vi.fn(),
    getConnectSession: vi.fn(),
    closeConnectSession: vi.fn(),
    deleteBrowserProfile: vi.fn()
  }
}));

async function buildApp(register: (app: any) => Promise<void> | void) {
  const app = Fastify();
  app.decorateRequest("user", null);
  await app.register(register);
  return app;
}

describe("route permission boundaries", () => {
  beforeEach(() => {
    state.role = "member";
    state.permissions = ["models.read"];
    state.auditCreate.mockReset();
    state.getModelPreferences.mockResolvedValue({
      models: [],
      autoSelectFirstUsable: true
    });
  });

  it("denies member API key creation", async () => {
    const app = await buildApp(apiKeyRoutes);
    const response = await app.inject({
      method: "POST",
      url: "/settings/api-keys",
      payload: { name: "blocked" }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "permission_denied" });
  });

  it("denies member provider connection writes", async () => {
    const app = await buildApp(providerRoutes);
    const response = await app.inject({
      method: "POST",
      url: "/providers/gemini/connect/start"
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "permission_denied" });
  });

  it("denies member recovery override rollback", async () => {
    const app = await buildApp(providerRecoveryPolicyRoutes);
    const response = await app.inject({
      method: "POST",
      url: "/settings/provider-recovery/overrides/override_1/rollback",
      payload: { resolution: "manual_rollback" }
    });
    expect(response.statusCode).toBe(403);
  });

  it("denies member webhook secret rotation", async () => {
    const app = await buildApp(notificationDeliveryRoutes);
    const response = await app.inject({
      method: "POST",
      url: "/settings/notification-delivery/webhook/rotate-secret"
    });
    expect(response.statusCode).toBe(403);
  });

  it("denies member provider diagnostics actions", async () => {
    const app = await buildApp(providerHealthRoutes);
    const response = await app.inject({
      method: "POST",
      url: "/settings/provider-health/gemini/refresh"
    });
    expect(response.statusCode).toBe(403);
  });

  it("denies member model preference and provider rate-limit writes", async () => {
    const modelsApp = await buildApp(modelPreferenceRoutes);
    const modelResponse = await modelsApp.inject({
      method: "PUT",
      url: "/settings/models",
      payload: { autoSelectFirstUsable: true, models: [] }
    });
    expect(modelResponse.statusCode).toBe(403);

    const rateLimitApp = await buildApp(providerRateLimitRoutes);
    const rateLimitResponse = await rateLimitApp.inject({
      method: "PATCH",
      url: "/settings/provider-rate-limits/gemini",
      payload: { requestsPerMinute: 10 }
    });
    expect(rateLimitResponse.statusCode).toBe(403);
  });

  it("allows member safe model reads", async () => {
    const app = await buildApp(modelPreferenceRoutes);
    const response = await app.inject({
      method: "GET",
      url: "/settings/models"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [],
      autoSelectFirstUsable: true
    });
  });
});
