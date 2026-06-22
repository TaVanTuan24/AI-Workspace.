import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { healthRoutes } from "../health.js";
import { getReadinessChecks } from "../../services/readinessService.js";

vi.mock("../../services/readinessService.js", () => ({
  getReadinessChecks: vi.fn(),
  isReady: (checks: Record<string, { status: string }>) =>
    Object.values(checks).every((check) => check.status === "ok")
}));

const readyChecks = {
  database: { status: "ok", latencyMs: 1 },
  redis: { status: "ok", latencyMs: 1 }
};

const buildApp = async () => {
  const app = Fastify();
  await app.register(healthRoutes);
  return app;
};

describe("health routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns liveness without dependency checks", async () => {
    const response = await (await buildApp()).inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(getReadinessChecks).not.toHaveBeenCalled();
  });

  it("returns readiness when dependencies are healthy", async () => {
    vi.mocked(getReadinessChecks).mockResolvedValueOnce(readyChecks as any);
    const response = await (await buildApp()).inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, checks: readyChecks });
  });

  it("returns 503 when a dependency is unhealthy", async () => {
    vi.mocked(getReadinessChecks).mockResolvedValueOnce({
      ...readyChecks,
      redis: { status: "error", latencyMs: 2, message: "Redis check failed." }
    } as any);

    const response = await (await buildApp()).inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("SESSION_MASTER_KEY");
    expect(response.body).not.toContain("INTERNAL_API_KEY");
  });
});
