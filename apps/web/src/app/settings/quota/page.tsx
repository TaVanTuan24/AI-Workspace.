"use client";

import { useEffect, useState } from "react";
import { 
  getWorkspaceQuotaSummary,
  WorkspaceUsageSummary,
  getWorkspaceQuotaEvents,
  WorkspaceQuotaEvent,
  hasPermission,
  permissionDeniedMessage,
  getSettingsOverview,
  getNotificationPreferences,
  getWorkspaceQuotaAlertSchedulerStatus,
  type WorkspaceQuotaAlertSchedulerStatus,
  type NotificationPreferences,
  type WorkspacePermission
} from "../../../lib/api";
import { QuotaPresetsCard } from "./QuotaPresetsCard";
import { QuotaReportCard } from "./QuotaReportCard";

export default function QuotaPage() {
  const [summary, setSummary] = useState<WorkspaceUsageSummary | null>(null);
  const [events, setEvents] = useState<WorkspaceQuotaEvent[]>([]);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<WorkspaceQuotaAlertSchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [overviewRes, quotaRes, eventsRes, prefsRes, schedulerRes] = await Promise.all([
        getSettingsOverview(),
        getWorkspaceQuotaSummary(),
        getWorkspaceQuotaEvents({ limit: 10 }).catch(() => ({ events: [] })),
        getNotificationPreferences().catch(() => null),
        getWorkspaceQuotaAlertSchedulerStatus().catch(() => null)
      ]);
      setPermissions(overviewRes.currentUser.permissions);
      setSummary(quotaRes);
      setEvents(eventsRes.events);
      if (prefsRes) {
        setNotificationPrefs(prefsRes.preferences);
      }
      if (schedulerRes) {
        setSchedulerStatus(schedulerRes);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load quota data");
    } finally {
      setLoading(false);
    }
  }

  const canReadSettings = hasPermission(permissions, "settings.read");

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Quota & Limits</h1>
        <p className="text-slate-400 mt-2">
          View your workspace resource usage and limits.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">
          {error}
        </div>
      )}

      {!canReadSettings && !loading && (
        <div className="bg-slate-800/70 text-slate-300 p-4 rounded-lg border border-slate-700">
          {permissionDeniedMessage}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500">Loading quota data...</div>
      ) : summary && canReadSettings ? (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50">
              <h2 className="text-lg font-medium text-slate-200">Current Plan: <span className="font-bold text-indigo-400 capitalize">{summary.plan}</span></h2>
            </div>
            <div className="divide-y divide-slate-800/50">
              {summary.quotas.map((q) => {
                const percent = q.limit ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 0;
                return (
                  <div key={q.resource} className="p-6 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-slate-200">{formatResourceName(q.resource)}</h3>
                        {q.exceeded && (
                          <span className="px-2 py-0.5 text-xs rounded bg-red-500/10 text-red-400 border border-red-500/20">
                            Exceeded
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-100">{q.used.toLocaleString()}</span>
                        <span className="text-slate-400">
                          / {q.limit === null ? "Unlimited" : q.limit.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    
                    {q.limit !== null && (
                      <div className="w-full md:w-64 space-y-2">
                        <div className="flex justify-between text-xs font-medium">
                          <span className={percent >= 90 ? "text-red-400" : "text-slate-400"}>
                            {percent}% used
                          </span>
                          <span className="text-slate-500">{q.remaining?.toLocaleString()} remaining</span>
                        </div>
                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all ${
                              q.exceeded ? "bg-red-500" : percent >= 90 ? "bg-amber-500" : "bg-indigo-500"
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          
          {notificationPrefs && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mt-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium text-slate-200">Quota Alerts</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    You will receive warnings when quotas reach {notificationPrefs.workspaceQuotaWarningThresholdPercent}% of their limit.
                    {notificationPrefs.notifyWorkspaceQuotaWarnings ? " (Warnings enabled)" : " (Warnings disabled)"}
                  </p>
                </div>
                <a
                  href="/settings/notifications"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Configure Alerts
                </a>
              </div>
            </div>
          )}

          {schedulerStatus && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl mt-8 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
                <h2 className="text-lg font-medium text-slate-200">Quota Alert Scheduler</h2>
                {schedulerStatus.enabled ? (
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Running
                  </span>
                ) : (
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                    Disabled
                  </span>
                )}
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div>
                    <div className="text-sm font-medium text-slate-400">Interval</div>
                    <div className="mt-1 text-slate-200">
                      {Math.round(schedulerStatus.intervalSeconds / 60)} minutes
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-400">Total Runs</div>
                    <div className="mt-1 text-slate-200">{schedulerStatus.runCount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-400">Last Run</div>
                    <div className="mt-1 text-slate-200">
                      {schedulerStatus.lastFinishedAt
                        ? new Date(schedulerStatus.lastFinishedAt).toLocaleString()
                        : "Never"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-400">Status</div>
                    <div className="mt-1 text-slate-200 capitalize">
                      {schedulerStatus.lastStatus || "Pending"}
                    </div>
                  </div>
                </div>

                {schedulerStatus.lastSummary && (
                  <div className="mt-6 p-4 rounded-lg bg-slate-950/50 border border-slate-800">
                    <h3 className="text-sm font-medium text-slate-300 mb-3">Last Run Summary</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500 block">Scanned Workspaces</span>
                        <span className="text-slate-200 font-medium">{schedulerStatus.lastSummary.scannedWorkspaces || 0}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Warnings Created</span>
                        <span className="text-amber-400 font-medium">{schedulerStatus.lastSummary.warningsCreated || 0}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Exceeded Created</span>
                        <span className="text-red-400 font-medium">{schedulerStatus.lastSummary.exceededCreated || 0}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Skipped</span>
                        <span className="text-slate-200 font-medium">{schedulerStatus.lastSummary.skipped || 0}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-8">
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50">
              <h2 className="text-lg font-medium text-slate-200">Recent Quota Exceeded Events</h2>
            </div>
            {events.length === 0 ? (
              <div className="p-6 text-slate-500 text-center">No recent quota exceeded events.</div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {events.map((evt) => (
                  <div key={evt.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-200">{formatResourceName(evt.resource)}</span>
                        <span className="text-slate-500 text-sm">from</span>
                        <span className="font-mono text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">{evt.source}</span>
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        Attempted to add <span className="font-medium text-slate-300">{evt.attemptedIncrement}</span> but limit is <span className="font-medium text-slate-300">{evt.limit === null ? "Unlimited" : evt.limit}</span> (Currently using {evt.used})
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(evt.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <QuotaPresetsCard onApply={loadData} />
          
          <QuotaReportCard />
        </div>
      ) : null}
    </div>
  );
}

function formatResourceName(resource: string) {
  const names: Record<string, string> = {
    members: "Workspace Members",
    pendingInvites: "Pending Invites",
    apiKeys: "API Keys",
    providerConnections: "Provider Connections",
    webhookDestinations: "Webhook Destinations",
    recoveryPolicies: "Recovery Policies",
    diagnosticsBaselines: "Diagnostics Baselines",
    monthlyApiRequests: "API Requests (Monthly)",
    monthlyInviteEmails: "Invite Emails (Monthly)"
  };
  return names[resource] || resource;
}
