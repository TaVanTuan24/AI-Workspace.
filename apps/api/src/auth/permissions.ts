export const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
  "settings.read",
  "apiKeys.read",
  "apiKeys.write",
  "providerConnections.read",
  "providerConnections.write",
  "providerDiagnostics.read",
  "providerDiagnostics.action",
  "webhooks.read",
  "webhooks.write",
  "notifications.read",
  "notifications.write",
  "usage.read",
  "models.read",
  "models.write",
  "release.read",
  "users.read",
  "users.manageRoles"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS = [...PERMISSIONS] satisfies Permission[];
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter((permission) => permission !== "users.manageRoles");

const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  member: [
    "settings.read",
    "providerDiagnostics.read",
    "notifications.read",
    "notifications.write",
    "usage.read",
    "models.read",
    "release.read"
  ],
  viewer: [
    "settings.read",
    "providerDiagnostics.read",
    "notifications.read",
    "usage.read",
    "models.read",
    "release.read"
  ]
};

export function normalizeWorkspaceRole(
  role: string | null | undefined,
  fallback: WorkspaceRole = "viewer"
): WorkspaceRole {
  return WORKSPACE_ROLES.includes(role as WorkspaceRole) ? (role as WorkspaceRole) : fallback;
}

export function getPermissionsForRole(role: string | null | undefined): Permission[] {
  return [...ROLE_PERMISSIONS[normalizeWorkspaceRole(role)]];
}

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  return ROLE_PERMISSIONS[normalizeWorkspaceRole(role)].includes(permission);
}

export function hasAnyPermission(role: string | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}
