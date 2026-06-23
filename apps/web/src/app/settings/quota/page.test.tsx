import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import QuotaPage from "./page";
import * as api from "../../../lib/api";

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual("../../../lib/api");
  return {
    ...actual,
    getWorkspaceQuotaSummary: vi.fn(),
    getSettingsOverview: vi.fn(),
    getWorkspaceQuotaEvents: vi.fn(),
    getWorkspaceQuotaReport: vi.fn().mockResolvedValue({ workspace: {}, eventsByResource: [], eventsBySource: [], recentEvents: [], quotas: [] }),
    listWorkspaceQuotaPresets: vi.fn().mockResolvedValue({ presets: [] }),
    applyWorkspaceQuotaPreset: vi.fn()
  };
});

describe("QuotaPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    vi.mocked(api.getSettingsOverview).mockResolvedValue({
      currentUser: { permissions: ["settings.read"] }
    } as any);
    vi.mocked(api.getWorkspaceQuotaSummary).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getWorkspaceQuotaEvents).mockReturnValue(new Promise(() => {}));
    
    render(<QuotaPage />);
    expect(screen.getByText("Loading quota data...")).toBeInTheDocument();
  });

  it("shows permission denied if missing settings.read", async () => {
    vi.mocked(api.getSettingsOverview).mockResolvedValue({
      currentUser: { permissions: [] }
    } as any);
    vi.mocked(api.getWorkspaceQuotaSummary).mockResolvedValue({
      plan: "local",
      quotas: []
    });
    vi.mocked(api.getWorkspaceQuotaEvents).mockResolvedValue({ events: [] });

    render(<QuotaPage />);
    
    await waitFor(() => {
      expect(screen.queryByText("Loading quota data...")).not.toBeInTheDocument();
    });
    
    expect(screen.getByText(api.permissionDeniedMessage)).toBeInTheDocument();
  });

  it("renders quota summary correctly", async () => {
    vi.mocked(api.getSettingsOverview).mockResolvedValue({
      currentUser: { permissions: ["settings.read"] }
    } as any);
    
    vi.mocked(api.getWorkspaceQuotaSummary).mockResolvedValue({
      plan: "enterprise",
      quotas: [
        {
          resource: "members" as any,
          limit: 10,
          used: 2,
          remaining: 8,
          exceeded: false
        },
        {
          resource: "pendingInvites" as any,
          limit: 5,
          used: 6,
          remaining: 0,
          exceeded: true
        }
      ]
    });
    vi.mocked(api.getWorkspaceQuotaEvents).mockResolvedValue({
      events: [
        {
          id: "evt-1",
          resource: "members",
          source: "workspace_invite_create",
          limit: 10,
          used: 10,
          attemptedIncrement: 1,
          createdAt: new Date().toISOString()
        }
      ]
    });

    render(<QuotaPage />);
    
    await waitFor(() => {
      expect(screen.getByText("enterprise")).toBeInTheDocument();
    });

    // Check members quota
    expect(screen.getAllByText("Workspace Members")[0]).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("/ 10")).toBeInTheDocument();
    
    // Check pending invites quota (exceeded)
    expect(screen.getByText("Pending Invites")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("/ 5")).toBeInTheDocument();
    expect(screen.getByText("Exceeded")).toBeInTheDocument();

    // Check events
    expect(screen.getByText("Recent Quota Exceeded Events")).toBeInTheDocument();
    expect(screen.getByText("workspace_invite_create")).toBeInTheDocument();
  });
});
