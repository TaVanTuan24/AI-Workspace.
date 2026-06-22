import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { onboardingRoutes } from "../onboarding.js";
import { getOnboardingStatus, updateOnboardingStatus } from "../../services/onboardingService.js";

vi.mock("../../services/onboardingService.js", () => ({
  getOnboardingStatus: vi.fn(),
  updateOnboardingStatus: vi.fn()
}));

const status = {
  completed: false,
  skipped: false,
  completedAt: null,
  skippedAt: null,
  lastStep: null,
  recommendedNextStep: "connect_provider",
  checklist: {
    hasConnectedProvider: false,
    hasUsableModel: false,
    hasDefaultModel: false,
    hasActiveApiKey: false,
    hasUsage: false
  }
};

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (request) => {
    request.user = { id: "local-user", email: "local@example.com" };
  });
  app.register(onboardingRoutes);
  return app;
};

describe("onboarding routes", () => {
  it("GET returns safe onboarding status", async () => {
    vi.mocked(getOnboardingStatus).mockResolvedValueOnce(status as any);
    const response = await buildApp().inject({ method: "GET", url: "/settings/onboarding" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recommendedNextStep: "connect_provider" });
    expect(response.body).not.toContain("rawKey");
    expect(response.body).not.toContain("cookie");
    expect(response.body).not.toContain("token");
  });

  it("PATCH updates last step", async () => {
    vi.mocked(updateOnboardingStatus).mockResolvedValueOnce({ ...status, lastStep: "choose_model" } as any);
    const response = await buildApp().inject({
      method: "PATCH",
      url: "/settings/onboarding",
      payload: { lastStep: "choose_model" }
    });

    expect(response.statusCode).toBe(200);
    expect(updateOnboardingStatus).toHaveBeenCalledWith("local-user", { lastStep: "choose_model" });
  });

  it("PATCH marks complete", async () => {
    vi.mocked(updateOnboardingStatus).mockResolvedValueOnce({ ...status, completed: true } as any);
    const response = await buildApp().inject({
      method: "PATCH",
      url: "/settings/onboarding",
      payload: { completed: true }
    });

    expect(response.statusCode).toBe(200);
    expect(updateOnboardingStatus).toHaveBeenCalledWith("local-user", { completed: true });
  });

  it("PATCH skips onboarding", async () => {
    vi.mocked(updateOnboardingStatus).mockResolvedValueOnce({ ...status, skipped: true } as any);
    const response = await buildApp().inject({
      method: "PATCH",
      url: "/settings/onboarding",
      payload: { skipped: true }
    });

    expect(response.statusCode).toBe(200);
    expect(updateOnboardingStatus).toHaveBeenCalledWith("local-user", { skipped: true });
  });
});
