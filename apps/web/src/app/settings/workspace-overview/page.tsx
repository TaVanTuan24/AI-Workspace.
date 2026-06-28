"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getWorkspaceAdminOverview,
  getSettingsOverview,
  hasPermission,
  permissionDeniedMessage,
  type WorkspaceAdminOverview,
  type WorkspacePermission
} from "../../../lib/api";

function StatCard({ title, children, href }: { title: string; children: React.ReactNode; href?: string }) {
  const inner = (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
      <h3 className="text-sm font-medium text-slate-400 mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Stat({ label, value, variant }: { label: string; value: number | string; variant?: "default" | "warning" | "error" | "success" }) {
  const colors = {
    default: "text-slate-200",
    warning: "text-amber-300",
    error: "text-red-400",
    success: "text-emerald-400",
  };
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`text-sm font-semibold ${colors[variant ?? "default"]}`}>{value}</span>
    </div>
  );
}

export default function WorkspaceOverviewPage() {
  const [overview, setOverview] = useState<WorkspaceAdminOverview | null>(null);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [overviewRes, adminRes] = await Promise.all([
        getSettingsOverview(),
        getWorkspaceAdminOverview(),
      ]);
      setPermissions(overviewRes.currentUser.permissions);
      setOverview(adminRes);
    } catch (err: any) {
      setError(err.message || "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }

  if (!loading && !hasPermission(permissions, "settings.read")) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="bg-slate-800/70 text-slate-300 p-4 rounded-lg border border-slate-700">
          {permissionDeniedMessage}
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading workspace overview...</div>;
  }

  if (!overview) {
    return <div className="p-8 text-center text-slate-500">Failed to load overview data.</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Workspace Admin Overview</h1>
        <p className="text-slate-400 mt-2">
          Consolidated status of {overview.workspace.name}
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Members" href="/settings/users">
          <Stat label="Active" value={overview.members.active} variant="success" />
          <Stat label="Disabled" value={overview.members.disabled} variant={overview.members.disabled > 0 ? "warning" : "default"} />
          <Stat label="Pending Invites" value={overview.members.pendingInvites} />
        </StatCard>

        <StatCard title="Quotas" href="/settings/quota">
          <Stat label="Exceeded" value={overview.quotas.exceeded} variant={overview.quotas.exceeded > 0 ? "error" : "success"} />
          <Stat label="Near Limit" value={overview.quotas.nearLimit} variant={overview.quotas.nearLimit > 0 ? "warning" : "default"} />
        </StatCard>

        <StatCard title="Notifications" href="/settings/notifications">
          <Stat label="Unread" value={overview.notifications.unread} variant={overview.notifications.unread > 0 ? "warning" : "default"} />
          <Stat label="Critical (7d)" value={overview.notifications.criticalRecent} variant={overview.notifications.criticalRecent > 0 ? "error" : "default"} />
        </StatCard>

        <StatCard title="Providers" href="/settings/connections">
          <Stat label="Usable" value={overview.providers.usable} variant="success" />
          <Stat label="Requires Attention" value={overview.providers.requiresAttention} variant={overview.providers.requiresAttention > 0 ? "warning" : "default"} />
        </StatCard>

        <StatCard title="Email Delivery">
          <Stat label="Provider" value={overview.emailDelivery.provider} />
          <Stat label="Enabled" value={overview.emailDelivery.enabled ? "Yes" : "No"} variant={overview.emailDelivery.enabled ? "success" : "default"} />
          <Stat label="Dry Run" value={overview.emailDelivery.dryRun ? "Yes" : "No"} variant={overview.emailDelivery.dryRun ? "warning" : "default"} />
          <Stat label="Real Send" value={overview.emailDelivery.realSendPossible ? "Ready" : "Blocked"} variant={overview.emailDelivery.realSendPossible ? "success" : "default"} />
        </StatCard>


        <StatCard title="Diagnostics" href="/settings/provider-health">
          <Stat label="Open Drift Alerts" value={overview.diagnostics.openDriftAlerts} variant={overview.diagnostics.openDriftAlerts > 0 ? "warning" : "success"} />
        </StatCard>

        <StatCard title="Schedulers" href="/settings/schedulers">
          {overview.schedulers.length === 0 ? (
            <p className="text-sm text-slate-500">No schedulers registered</p>
          ) : (
            overview.schedulers.map((s) => (
              <div key={s.name} className="flex justify-between items-center">
                <span className="text-xs text-slate-400 truncate">{s.name.replace(/_/g, " ")}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  s.enabled ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800 text-slate-500"
                }`}>
                  {s.enabled ? (s.lastStatus ?? "enabled") : "disabled"}
                </span>
              </div>
            ))
          )}
        </StatCard>
      </div>
    </div>
  );
}
