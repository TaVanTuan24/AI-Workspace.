"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, UsersRound } from "lucide-react";
import {
  getManagedUsers,
  getSettingsOverview,
  getWorkspaceAuditEvents,
  hasPermission,
  updateManagedUserRole,
  updateMembershipStatus,
  listWorkspaceInvites,
  createWorkspaceInvite,
  revokeWorkspaceInvite,
  getWorkspaceInviteExpirySchedulerStatus,
  WorkspaceInviteEmailDeliveryStatus,
  getWorkspaceInviteEmailDeliveryStatus,
  sendWorkspaceInviteDeliveryTest,
  getWorkspaceInviteDeliveryAttempts,
  type WorkspaceInviteDeliveryAttempt,
  type ManagedUser,
  type UserRoleAuditEvent,
  type WorkspacePermission,
  type WorkspaceRole,
  type WorkspaceInvite,
  type CreateWorkspaceInviteResult,
  type SchedulerStatusView,
  getWorkspaceQuotaSummary,
  type WorkspaceUsageSummary
} from "../../../lib/api";

const roles: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

const roleLabels: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer"
};

export default function UsersAndRolesPage() {
  const [currentUserId, setCurrentUserId] = useState("");
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [auditEvents, setAuditEvents] = useState<UserRoleAuditEvent[]>([]);
  const [pendingChange, setPendingChange] = useState<{ user: ManagedUser; role: WorkspaceRole } | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [newInviteData, setNewInviteData] = useState<CreateWorkspaceInviteResult | null>(null);

  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatusView | null>(null);
  const [deliveryConfig, setDeliveryConfig] = useState<WorkspaceInviteEmailDeliveryStatus | null>(null);

  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; provider: string; testSubject?: string; error?: string } | null>(null);

  const [viewingAttemptsFor, setViewingAttemptsFor] = useState<string | null>(null);
  const [deliveryAttempts, setDeliveryAttempts] = useState<WorkspaceInviteDeliveryAttempt[] | null>(null);
  const [loadingAttempts, setLoadingAttempts] = useState(false);

  const [quotaSummary, setQuotaSummary] = useState<WorkspaceUsageSummary | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [overview, userData, auditData, inviteData, schedulerData, emailStatusData, quotaData] = await Promise.all([
        getSettingsOverview(),
        getManagedUsers(),
        getWorkspaceAuditEvents(50).catch(() => ({ events: [] })),
        listWorkspaceInvites().catch(() => ({ invites: [] })),
        getWorkspaceInviteExpirySchedulerStatus().catch(() => null),
        getWorkspaceInviteEmailDeliveryStatus().catch(() => null),
        getWorkspaceQuotaSummary().catch(() => null)
      ]);
      setCurrentUserId(overview.currentUser.id);
      setPermissions(overview.currentUser.permissions);
      setUsers(userData.users);
      setAuditEvents(auditData.events);
      setInvites(inviteData.invites);
      setSchedulerStatus(schedulerData);
      setDeliveryConfig(emailStatusData);
      setQuotaSummary(quotaData);
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to load users"));
    } finally {
      setLoading(false);
    }
  }

  const canReadUsers = hasPermission(permissions, "users.read");
  const canManageRoles = hasPermission(permissions, "users.manageRoles");
  const ownerCount = users.filter((user) => user.role === "owner").length;
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  function requestRoleChange(user: ManagedUser, role: WorkspaceRole) {
    setError("");
    setNotice("");
    if (!canManageRoles) {
      setError("You don't have permission to perform this action.");
      return;
    }
    if (user.role === role) return;
    setPendingChange({ user, role });
  }

  async function confirmRoleChange() {
    if (!pendingChange) return;
    try {
      setSavingUserId(pendingChange.user.id);
      setError("");
      setNotice("");
      const requiresSelfConfirm = pendingChange.user.id === currentUserId && pendingChange.user.role === "owner" && pendingChange.role !== "owner";
      await updateManagedUserRole({
        userId: pendingChange.user.id,
        role: pendingChange.role,
        confirmSelfDemotion: requiresSelfConfirm
      });
      setNotice(`${displayUser(pendingChange.user)} is now ${roleLabels[pendingChange.role]}.`);
      setPendingChange(null);
      await loadData();
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to update role"));
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail || !canManageRoles) return;
    try {
      setCreatingInvite(true);
      setError("");
      setNewInviteData(null);
      const res = await createWorkspaceInvite({ email: inviteEmail, role: inviteRole });
      setNotice(`Invite sent to ${inviteEmail}.`);
      setNewInviteData(res);
      setInviteEmail("");
      setInviteRole("member");
      await loadData();
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to create invite"));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    try {
      setError("");
      setNotice("");
      await revokeWorkspaceInvite(inviteId);
      setNotice("Invite revoked.");
      await loadData();
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to revoke invite"));
    }
  }

  async function handleTestEmailDelivery() {
    if (!deliveryConfig) return;
    
    let allowRealSendTest = false;
    if (deliveryConfig.realSendPossible && deliveryConfig.provider === "smtp") {
      allowRealSendTest = window.confirm("Real SMTP send is enabled. Do you want to send a real test email to your address?");
    }

    try {
      setTestingEmail(true);
      setError("");
      setTestResult(null);
      const res = await sendWorkspaceInviteDeliveryTest({ allowRealSendTest });
      setTestResult(res);
      setNotice(`Test complete: ${res.status} via ${res.provider}`);
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to run delivery test"));
    } finally {
      setTestingEmail(false);
    }
  }

  async function handleViewDeliveryAttempts(inviteId: string) {
    if (viewingAttemptsFor === inviteId) {
      setViewingAttemptsFor(null);
      return;
    }
    setViewingAttemptsFor(inviteId);
    try {
      setLoadingAttempts(true);
      const res = await getWorkspaceInviteDeliveryAttempts(inviteId);
      setDeliveryAttempts(res.attempts);
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to load delivery attempts"));
    } finally {
      setLoadingAttempts(false);
    }
  }

  async function handleToggleStatus(user: ManagedUser) {
    if (!canManageRoles) return;
    try {
      setSavingUserId(user.id);
      setError("");
      setNotice("");
      const nextStatus = user.status === "active" ? "disabled" : "active";
      await updateMembershipStatus({ userId: user.id, status: nextStatus });
      setNotice(`${displayUser(user)} is now ${nextStatus}.`);
      await loadData();
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to update membership status"));
    } finally {
      setSavingUserId(null);
    }
  }

  if (!loading && !canReadUsers) {
    return (
      <div className="space-y-6 p-0 lg:p-2">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Users & Roles</h1>
        </header>
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          You don't have permission to perform this action.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-0 lg:p-2">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300">
            <UsersRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Users & Roles</h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Review workspace users and keep administrative role boundaries explicit.
          </p>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {canManageRoles ? "Owner controls enabled" : "Read-only access"}
          </div>
          <div className="mt-1 text-emerald-100/80">The last owner cannot be demoted.</div>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          {notice}
        </div>
      ) : null}

      {quotaSummary && quotaSummary.quotas.find(q => q.resource === "members" && q.exceeded) && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Workspace member limit reached. <a href="/settings/quota" className="underline hover:text-red-200 ml-1">View quotas</a></span>
        </div>
      )}

      {quotaSummary && quotaSummary.quotas.find(q => q.resource === "pendingInvites" && q.exceeded) && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Workspace pending invites limit reached. <a href="/settings/quota" className="underline hover:text-red-200 ml-1">View quotas</a></span>
        </div>
      )}

      {!canManageRoles && !loading ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-sm text-slate-300">
          Admins can view users in v1. Only owners can change roles.
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-100">Workspace Users</h2>
          <p className="mt-1 text-sm text-slate-500">{ownerCount} owner{ownerCount === 1 ? "" : "s"} configured.</p>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading users...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950 text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Updated</th>
                  <th className="px-5 py-3 text-right font-medium">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {users.map((user) => {
                  const lastOwner = user.role === "owner" && ownerCount <= 1;
                  const self = user.id === currentUserId;
                  return (
                    <tr key={user.id}>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-100">{displayUser(user)}</div>
                        {self ? <div className="mt-1 text-xs text-indigo-300">Current user</div> : null}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className={roleBadge(user.role)}>{roleLabels[user.role]}</span>
                          {user.status === "disabled" && (
                            <span className="inline-flex rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300">
                              Disabled
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-300">{formatDate(user.createdAt)}</td>
                      <td className="px-5 py-4 text-slate-300">{formatDate(user.updatedAt)}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end">
                          <select
                            aria-label={`Role for ${displayUser(user)}`}
                            value={user.role}
                            disabled={!canManageRoles || savingUserId === user.id || lastOwner || self}
                            onChange={(event) => requestRoleChange(user, event.target.value as WorkspaceRole)}
                            className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none focus:border-indigo-500 disabled:opacity-50"
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>{roleLabels[role]}</option>
                            ))}
                          </select>
                          {canManageRoles && !lastOwner && !self && (
                            <button
                              onClick={() => handleToggleStatus(user)}
                              disabled={savingUserId === user.id}
                              className="ml-2 h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                            >
                              {user.status === "active" ? "Disable" : "Enable"}
                            </button>
                          )}
                        </div>
                        {lastOwner ? (
                          <div className="mt-2 flex justify-end text-xs text-amber-300">Last owner cannot be demoted.</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManageRoles ? (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Workspace Invites</h2>
                <p className="mt-1 text-sm text-slate-500">Invite new members to join the workspace.</p>
              </div>
              {deliveryConfig && (
                <div className="flex flex-col gap-2 text-right">
                  <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1 text-xs text-slate-300 ml-auto">
                    <span className={`h-2 w-2 rounded-full ${!deliveryConfig.enabled ? "bg-slate-500" : !deliveryConfig.realSendPossible && deliveryConfig.provider === "smtp" ? "bg-red-400" : deliveryConfig.dryRun ? "bg-amber-400" : "bg-emerald-400"}`} />
                    {!deliveryConfig.enabled ? "Email delivery not configured" : deliveryConfig.provider === "console_dry_run" || deliveryConfig.dryRun ? "Dry-run mode" : !deliveryConfig.realSendPossible ? (deliveryConfig.missingRequiredConfig.length > 0 ? "SMTP incomplete" : "SMTP configured, real send disabled") : "SMTP ready"}
                  </div>
                  {deliveryConfig.warnings.length > 0 && (
                    <div className="text-[10px] text-amber-400/80 max-w-xs">{deliveryConfig.warnings[0]}</div>
                  )}
                  <button
                    onClick={handleTestEmailDelivery}
                    disabled={testingEmail}
                    className="self-end text-[10px] font-medium uppercase text-indigo-400 hover:text-indigo-300 disabled:opacity-50 mt-1"
                  >
                    {testingEmail ? "Testing..." : deliveryConfig.realSendPossible ? "Send test email" : "Preview test"}
                  </button>
                  {testResult && (
                    <div className="mt-2 text-xs text-left max-w-xs rounded border border-slate-700 bg-slate-800 p-2 text-slate-300">
                      <div><span className="font-semibold">Status:</span> {testResult.status}</div>
                      <div><span className="font-semibold">Provider:</span> {testResult.provider}</div>
                      {testResult.testSubject && <div><span className="font-semibold">Preview:</span> {testResult.testSubject}</div>}
                      {testResult.error && <div className="text-red-400"><span className="font-semibold">Error:</span> {testResult.error}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="p-5">
            {newInviteData && (
              <div className="mb-6 rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-4">
                <h3 className="font-medium text-indigo-300">Invite created successfully</h3>
                <p className="mt-2 text-sm text-indigo-200">
                  {!deliveryConfig?.enabled ? (
                    `Email delivery is disabled by default (${newInviteData.delivery.channel} \u00B7 ${newInviteData.delivery.status.replace(/_/g, " ")}). Please copy the invite link manually.`
                  ) : deliveryConfig?.dryRun ? (
                    `Email delivery is in dry-run mode (${newInviteData.delivery.channel} \u00B7 ${newInviteData.delivery.status.replace(/_/g, " ")}). Please copy the invite link manually.`
                  ) : (
                    `Invite email queued for delivery (${newInviteData.delivery.channel} \u00B7 ${newInviteData.delivery.status.replace(/_/g, " ")}). You can also copy the link manually if needed.`
                  )}
                </p>
                <div className="mt-3 flex items-center justify-between rounded border border-slate-800 bg-slate-950 p-3 font-mono text-sm text-slate-300">
                  <span className="truncate mr-4">{newInviteData.inviteUrl || newInviteData.token}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(newInviteData.inviteUrl || newInviteData.token)}
                    className="shrink-0 text-indigo-400 hover:text-indigo-300 text-xs font-medium uppercase"
                  >
                    Copy Link
                  </button>
                </div>
                {newInviteData.emailPreview && (
                  <div className="mt-4 border-t border-indigo-500/20 pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-medium text-indigo-300">Email Preview</h4>
                      <button
                        onClick={() => navigator.clipboard.writeText(newInviteData.emailPreview!.text)}
                        className="text-xs font-medium text-indigo-400 hover:text-indigo-300 uppercase"
                      >
                        Copy Text
                      </button>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950 p-3 text-sm text-slate-400">
                      <div className="mb-2 font-medium text-slate-300">Subject: {newInviteData.emailPreview.subject}</div>
                      <div className="whitespace-pre-wrap">{newInviteData.emailPreview.text}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <form onSubmit={handleCreateInvite} className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="inviteEmail" className="mb-2 block text-sm font-medium text-slate-300">Email Address</label>
                <input
                  id="inviteEmail"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label htmlFor="inviteRole" className="mb-2 block text-sm font-medium text-slate-300">Role</label>
                <select
                  id="inviteRole"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                  className="w-full sm:w-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>{roleLabels[role]}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={creatingInvite || !inviteEmail}
                className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {creatingInvite ? "Sending..." : "Create Invite"}
              </button>
            </form>

            {invites.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-800 bg-slate-950 text-slate-400">
                    <tr>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Delivery</th>
                      <th className="px-4 py-2 font-medium">Expires</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {invites.map((invite) => (
                      <React.Fragment key={invite.id}>
                        <tr>
                          <td className="px-4 py-3 font-medium text-slate-200">{invite.email}</td>
                        <td className="px-4 py-3">
                          <span className={roleBadge(invite.role)}>{roleLabels[invite.role]}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 capitalize">{invite.status}</td>
                        <td className="px-4 py-3 text-slate-400">
                          {invite.latestDelivery ? (
                            <div className="text-xs">
                              <span className="capitalize">{invite.latestDelivery.channel}</span>
                              <span className="mx-1">&middot;</span>
                              <span className="capitalize">{invite.latestDelivery.status.replace(/_/g, " ")}</span>
                            </div>
                          ) : (
                            <span className="text-xs">Not configured</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400">{formatDate(invite.expiresAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleViewDeliveryAttempts(invite.id)}
                            className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                          >
                            Details
                          </button>
                          {invite.status === "pending" && (
                            <button
                              onClick={() => handleRevokeInvite(invite.id)}
                              className="ml-3 text-xs font-medium text-red-400 hover:text-red-300"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                        </tr>
                        {viewingAttemptsFor === invite.id && (
                          <tr className="bg-slate-900/50">
                            <td colSpan={6} className="px-4 py-3 border-t border-slate-800">
                              <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase">Delivery Details</h4>
                              {loadingAttempts ? (
                                <div className="text-xs text-slate-500">Loading attempts...</div>
                              ) : deliveryAttempts && deliveryAttempts.length > 0 ? (
                                <ul className="space-y-2">
                                  {deliveryAttempts.map(attempt => (
                                    <li key={attempt.id} className="text-xs p-2 rounded border border-slate-800 bg-slate-950">
                                      <div className="flex items-center gap-2 text-slate-300 mb-1">
                                        <span className={`h-1.5 w-1.5 rounded-full ${attempt.status === "sent" ? "bg-emerald-400" : attempt.status.startsWith("skipped") ? "bg-amber-400" : "bg-red-400"}`} />
                                        <span className="font-semibold">{attempt.channel} &middot; {attempt.provider}</span>
                                        <span className="text-slate-500 ml-auto">{new Date(attempt.createdAt).toLocaleString()}</span>
                                      </div>
                                      <div className="text-slate-400">Status: <span className="capitalize">{attempt.status.replace(/_/g, " ")}</span></div>
                                      {attempt.reason && <div className="text-slate-500 mt-1">Reason: {attempt.reason}</div>}
                                      {attempt.recipientEmailRedacted && <div className="text-slate-500">To: {attempt.recipientEmailRedacted}</div>}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="text-xs text-slate-500">No delivery attempts recorded.</div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {canManageRoles && schedulerStatus ? (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-100">Invite Expiry Scheduler</h2>
            <p className="mt-1 text-sm text-slate-500">Automated background cleanup for expired workspace invites.</p>
          </div>
          <div className="p-5">
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded-md border border-slate-800 bg-slate-800/50 p-3">
                <div className="text-xs text-slate-500">Status</div>
                <div className="mt-1 font-medium capitalize text-slate-200">
                  {schedulerStatus.enabled ? schedulerStatus.lastStatus || "Pending" : "Disabled"}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-800/50 p-3">
                <div className="text-xs text-slate-500">Runs</div>
                <div className="mt-1 font-medium text-slate-200">{schedulerStatus.runCount}</div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-800/50 p-3">
                <div className="text-xs text-slate-500">Last Scanned</div>
                <div className="mt-1 font-medium text-slate-200">{schedulerStatus.lastSummary?.scanned ?? 0}</div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-800/50 p-3">
                <div className="text-xs text-slate-500">Last Expired</div>
                <div className="mt-1 font-medium text-slate-200">{schedulerStatus.lastSummary?.expired ?? 0}</div>
              </div>
            </div>
            {schedulerStatus.lastStartedAt && (
              <p className="mt-4 text-xs text-slate-500">
                Last run started at: {formatDate(schedulerStatus.lastStartedAt)}
              </p>
            )}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-100">Workspace Access Timeline</h2>
          <p className="mt-1 text-sm text-slate-500">Safe metadata only. Raw tokens are not stored.</p>
        </div>
        <div className="divide-y divide-slate-800">
          {auditEvents.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">No access changes recorded yet.</div>
          ) : auditEvents.map((event) => {
            const targetName = event.targetUserId ? displayUser(userById.get(event.targetUserId)) : event.inviteId ? `Invite [${event.inviteId.slice(-6)}]` : "Unknown User";
            const actorName = displayUser(userById.get(event.actorUserId));
            
            let message = "";
            if (event.action === "membership_created") {
              message = ` invited to workspace as ${event.nextRole ? roleLabels[event.nextRole] : "Unknown"}`;
            } else if (event.action === "membership_enabled") {
              message = ` membership enabled by ${actorName}`;
            } else if (event.action === "membership_disabled") {
              message = ` membership disabled by ${actorName}`;
            } else if (event.action === "user.role.changed") {
              message = ` changed from ${event.previousRole ? roleLabels[event.previousRole] : "Unknown"} to ${event.nextRole ? roleLabels[event.nextRole] : "Unknown"} by ${actorName}`;
            } else if (event.action === "invite_expired") {
              message = ` automatically expired by scheduler`;
            } else {
              message = ` action ${event.action} performed by ${actorName}`;
            }

            return (
              <div key={event.id} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1fr_auto]">
                <div>
                  <span className="text-slate-100">{targetName}</span>
                  <span className="text-slate-500">{message}</span>
                </div>
                <div className="text-slate-500">{formatDate(event.createdAt)}</div>
              </div>
            );
          })}
        </div>
      </section>

      {pendingChange ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Confirm role change</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Change {displayUser(pendingChange.user)} from {roleLabels[pendingChange.user.role]} to {roleLabels[pendingChange.role]}?
                </p>
                {pendingChange.role === "owner" ? (
                  <p className="mt-2 text-sm text-amber-200">Owners can manage all workspace roles and sensitive settings.</p>
                ) : null}
                {pendingChange.user.id === currentUserId && pendingChange.user.role === "owner" && pendingChange.role !== "owner" ? (
                  <p className="mt-2 text-sm text-amber-200">You are demoting your own owner role. Another owner must remain.</p>
                ) : null}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingChange(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRoleChange}
                disabled={savingUserId === pendingChange.user.id}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function displayUser(user: ManagedUser | undefined) {
  if (!user) return "Unknown user";
  return user.name || user.email || "Unnamed user";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function friendlyError(message: string) {
  const map: Record<string, string> = {
    permission_denied: "You don't have permission to perform this action.",
    last_owner_required: "At least one owner must remain.",
    self_demote_confirmation_required: "Self-demotion requires explicit confirmation.",
    invalid_role: "Invalid role.",
    user_not_found: "User not found.",
    workspace_quota_exceeded: "Workspace limit reached. Check your Quota & Limits settings."
  };
  return map[message] ?? message;
}

function roleBadge(role: WorkspaceRole) {
  const base = "inline-flex rounded-md border px-2 py-1 text-xs font-medium";
  if (role === "owner") return `${base} border-indigo-500/20 bg-indigo-500/10 text-indigo-300`;
  if (role === "admin") return `${base} border-emerald-500/20 bg-emerald-500/10 text-emerald-300`;
  if (role === "member") return `${base} border-sky-500/20 bg-sky-500/10 text-sky-300`;
  return `${base} border-slate-700 bg-slate-800 text-slate-300`;
}
