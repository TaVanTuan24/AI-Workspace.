import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ApiKeysPage from "./page";

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    apiGetApiKeys: vi.fn().mockResolvedValue({ keys: [] }),
    apiGetModelPreferences: vi.fn().mockResolvedValue({ models: [], autoSelectFirstUsable: true }),
    getWorkspaceNotifications: vi.fn().mockResolvedValue({ notifications: [], unreadCount: 0 }),
    getSettingsOverview: vi.fn().mockResolvedValue({
      currentUser: {
        id: "member_1",
        role: "member",
        permissions: ["settings.read", "models.read"]
      },
      providers: { total: 0, connected: 0, usable: 0, requiresLogin: 0 },
      models: { total: 0, enabled: 0, usable: 0, defaultModelId: null },
      apiKeys: { active: 0, revoked: 0 },
      usage: { requests24h: 0, failed24h: 0, rateLimited24h: 0, providerRateLimited24h: 0, requests7d: 0 },
      backups: { lastExportAt: null, tracked: false },
      scheduler: { providerHealthEnabled: false },
      providerHealth: { openIncidents: 0, criticalOpenIncidents: 0, lastIncidentAt: null }
    })
  };
});

describe("ApiKeysPage permissions", () => {
  it("renders read-only controls without apiKeys.write", async () => {
    render(<ApiKeysPage />);

    expect(await screen.findByText("You don't have permission to perform this action.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create key/i })).toBeDisabled();
  });
});
