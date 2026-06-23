"use client";

import { useEffect, useState } from "react";
import {
  getSchedulerFleetStatus,
  getSettingsOverview,
  hasPermission,
  permissionDeniedMessage,
  type SchedulerFleetEntry,
  type WorkspacePermission
} from "../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  running: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  failed: "bg-red-500/10 text-red-300 border-red-500/20",
  skipped: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  disabled: "bg-slate-800 text-slate-500 border-slate-700",
};

export default function SchedulersPage() {
  const [schedulers, setSchedulers] = useState<SchedulerFleetEntry[]>([]);
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
      const [overviewRes, fleetRes] = await Promise.all([
        getSettingsOverview(),
        getSchedulerFleetStatus(),
      ]);
      setPermissions(overviewRes.currentUser.permissions);
      setSchedulers(fleetRes.schedulers);
    } catch (err: any) {
      setError(err.message || "Failed to load schedulers");
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

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Scheduler Fleet Status</h1>
        <p className="text-slate-400 mt-2">
          Background job schedulers managing health checks, invite expiry, quota alerts, and recovery policies.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-4 rounded-lg border border-red-500/20">{error}</div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500">Loading schedulers...</div>
      ) : schedulers.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <div className="text-slate-500 text-lg">No schedulers registered</div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-4 font-medium">SCHEDULER</th>
                <th className="px-6 py-4 font-medium">STATUS</th>
                <th className="px-6 py-4 font-medium">ENABLED</th>
                <th className="px-6 py-4 font-medium">RUNS</th>
                <th className="px-6 py-4 font-medium">FAILURES</th>
                <th className="px-6 py-4 font-medium">SKIPPED</th>
                <th className="px-6 py-4 font-medium">LAST RUN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {schedulers.map((s) => (
                <tr key={s.name}>
                  <td className="px-6 py-4 font-medium text-slate-200 whitespace-nowrap">
                    {s.name.replace(/_/g, " ")}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${
                      STATUS_COLORS[s.lastStatus ?? "disabled"]
                    }`}>
                      {s.lastStatus ?? "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      s.enabled ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800 text-slate-500"
                    }`}>
                      {s.enabled ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-6 py-4">{s.runCount}</td>
                  <td className="px-6 py-4">
                    <span className={s.failureCount > 0 ? "text-red-400" : ""}>{s.failureCount}</span>
                  </td>
                  <td className="px-6 py-4">{s.skippedCount}</td>
                  <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                    {s.lastFinishedAt ? new Date(s.lastFinishedAt).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Safe summaries */}
          {schedulers.some((s) => s.lastSummary) && (
            <div className="border-t border-slate-800 p-6 space-y-3">
              <h3 className="text-sm font-medium text-slate-400">Last Run Summaries</h3>
              {schedulers
                .filter((s) => s.lastSummary)
                .map((s) => (
                  <div key={s.name} className="bg-slate-800/50 rounded-lg p-3">
                    <div className="text-xs font-medium text-slate-300 mb-1">{s.name.replace(/_/g, " ")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(s.lastSummary!).map(([key, value]) => (
                        <span key={key} className="px-2 py-0.5 bg-slate-900 text-slate-400 rounded text-xs">
                          {key}: {String(value ?? "—")}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
