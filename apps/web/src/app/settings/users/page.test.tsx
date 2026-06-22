import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersAndRolesPage from "./page";

const state = vi.hoisted(() => ({
  currentUserId: "owner_1",
  permissions: ["settings.read", "users.read", "users.manageRoles"],
  users: [
    {
      id: "owner_1",
      email: "owner@example.com",
      name: "Owner One",
      role: "owner",
      createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-01-01T00:00:00Z").toISOString()
    },
    {
      id: "member_1",
      email: "member@example.com",
      name: "Member One",
      role: "member",
      createdAt: new Date("2026-01-02T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-01-02T00:00:00Z").toISOString()
    }
  ],
  updateManagedUserRole: vi.fn()
}));

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    getSettingsOverview: vi.fn(async () => ({
      currentUser: {
        id: state.currentUserId,
        role: state.currentUserId === "owner_1" ? "owner" : "admin",
        permissions: state.permissions
      },
      providers: { total: 0, connected: 0, usable: 0, requiresLogin: 0 },
      models: { total: 0, enabled: 0, usable: 0, defaultModelId: null },
      apiKeys: { active: 0, revoked: 0 },
      usage: { requests24h: 0, failed24h: 0, rateLimited24h: 0, providerRateLimited24h: 0, requests7d: 0 },
      backups: { lastExportAt: null, tracked: false },
      scheduler: { providerHealthEnabled: false },
      providerHealth: { openIncidents: 0, criticalOpenIncidents: 0, lastIncidentAt: null }
    })),
    getManagedUsers: vi.fn(async () => ({ users: state.users })),
    getWorkspaceAuditEvents: vi.fn(async () => ({ events: [] })),
    getWorkspaceInviteExpirySchedulerStatus: vi.fn(async () => null),
    updateManagedUserRole: state.updateManagedUserRole,
    listWorkspaceInvites: vi.fn(async () => ({ invites: [] })),
    createWorkspaceInvite: vi.fn(),
    revokeWorkspaceInvite: vi.fn()
  };
});

describe("UsersAndRolesPage permissions", () => {
  beforeEach(() => {
    state.currentUserId = "owner_1";
    state.permissions = ["settings.read", "users.read", "users.manageRoles"];
    state.users = [
      {
        id: "owner_1",
        email: "owner@example.com",
        name: "Owner One",
        role: "owner",
        createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
        updatedAt: new Date("2026-01-01T00:00:00Z").toISOString()
      },
      {
        id: "member_1",
        email: "member@example.com",
        name: "Member One",
        role: "member",
        createdAt: new Date("2026-01-02T00:00:00Z").toISOString(),
        updatedAt: new Date("2026-01-02T00:00:00Z").toISOString()
      }
    ] as any;
    state.updateManagedUserRole.mockReset();
    state.updateManagedUserRole.mockResolvedValue({ user: state.users[1] });
  });

  it("lets owners see role controls", async () => {
    render(<UsersAndRolesPage />);

    expect(await screen.findByText("Owner controls enabled")).toBeInTheDocument();
    expect(screen.getByLabelText(/role for member one/i)).not.toBeDisabled();
  });

  it("shows admins a read-only user list", async () => {
    state.currentUserId = "admin_1";
    state.permissions = ["settings.read", "users.read"];
    render(<UsersAndRolesPage />);

    expect(await screen.findByText("Read-only access")).toBeInTheDocument();
    expect(screen.getByLabelText(/role for member one/i)).toBeDisabled();
  });

  it("shows denied state for member/viewer without users.read", async () => {
    state.permissions = ["settings.read"];
    render(<UsersAndRolesPage />);

    expect(await screen.findByText("You don't have permission to perform this action.")).toBeInTheDocument();
  });

  it("disables last owner demotion", async () => {
    render(<UsersAndRolesPage />);

    expect(await screen.findByText("Last owner cannot be demoted.")).toBeInTheDocument();
    expect(screen.getByLabelText(/role for owner one/i)).toBeDisabled();
  });

  it("requires confirmation for self-demotion when another owner exists", async () => {
    state.users = [
      state.users[0],
      {
        id: "owner_2",
        email: "owner2@example.com",
        name: "Owner Two",
        role: "owner",
        createdAt: new Date("2026-01-03T00:00:00Z").toISOString(),
        updatedAt: new Date("2026-01-03T00:00:00Z").toISOString()
      },
      state.users[1]
    ] as any;
    render(<UsersAndRolesPage />);

    const selfRole = await screen.findByLabelText(/role for owner one/i);
    fireEvent.change(selfRole, { target: { value: "admin" } });

    expect(await screen.findByText("Confirm role change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(state.updateManagedUserRole).toHaveBeenCalledWith({
        userId: "owner_1",
        role: "admin",
        confirmSelfDemotion: true
      });
    });
  });
});
