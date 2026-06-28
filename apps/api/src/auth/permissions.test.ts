import { describe, expect, it } from "vitest";
import {
  getPermissionsForRole,
  hasPermission,
  normalizeWorkspaceRole
} from "./permissions.js";

describe("workspace permission policy", () => {
  it("grants owner and admin all sensitive permissions", () => {
    for (const role of ["owner", "admin"]) {
      expect(hasPermission(role, "apiKeys.write")).toBe(true);
      expect(hasPermission(role, "providerConnections.write")).toBe(true);
      expect(hasPermission(role, "webhooks.write")).toBe(true);
      expect(hasPermission(role, "models.write")).toBe(true);
    }
  });

  it("allows admins to read users but keeps role management owner-only", () => {
    expect(hasPermission("owner", "users.read")).toBe(true);
    expect(hasPermission("owner", "users.manageRoles")).toBe(true);
    expect(hasPermission("admin", "users.read")).toBe(true);
    expect(hasPermission("admin", "users.manageRoles")).toBe(false);
    expect(hasPermission("member", "users.read")).toBe(false);
    expect(hasPermission("viewer", "users.read")).toBe(false);
  });

  it("allows members read-oriented workspace access but blocks high-risk writes", () => {
    expect(hasPermission("member", "settings.read")).toBe(true);
    expect(hasPermission("member", "usage.read")).toBe(true);
    expect(hasPermission("member", "models.read")).toBe(true);
    expect(hasPermission("member", "apiKeys.write")).toBe(false);
    expect(hasPermission("member", "providerConnections.write")).toBe(false);
    expect(hasPermission("member", "webhooks.write")).toBe(false);
    expect(hasPermission("member", "models.write")).toBe(false);
  });

  it("keeps viewers read-only for dashboards", () => {
    expect(getPermissionsForRole("viewer")).toEqual([
      "settings.read",
      "providerDiagnostics.read",
      "notifications.read",
      "usage.read",
      "models.read",
      "release.read"
    ]);
    expect(hasPermission("viewer", "notifications.write")).toBe(false);
    expect(hasPermission("viewer", "providerDiagnostics.action")).toBe(false);
  });

  it("normalizes unknown persisted roles to viewer", () => {
    expect(normalizeWorkspaceRole("unexpected")).toBe("viewer");
  });
});
