import { useEffect, useState } from "react";
import { listProviderDiagnosticsDriftAlerts, resolveProviderDiagnosticsDriftAlert, setProviderDiagnosticsBaseline } from "../../../lib/api";

export function DiagnosticsDriftAlertsPanel() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadAlerts();
  }, []);

  async function loadAlerts() {
    try {
      setLoading(true);
      setError("");
      const res = await listProviderDiagnosticsDriftAlerts({ status: "open", limit: 50 });
      setAlerts(res.data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load drift alerts");
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(alertId: string, resolution: "accepted_change" | "fixed" | "ignored", runId?: string) {
    try {
      if (resolution === "accepted_change" && runId) {
        await setProviderDiagnosticsBaseline(runId, `Accepted change from alert ${alertId.substring(0, 8)}`, true);
      }
      await resolveProviderDiagnosticsDriftAlert(alertId, resolution);
      loadAlerts();
    } catch (err: any) {
      alert("Failed to resolve alert: " + err.message);
    }
  }

  if (loading && alerts.length === 0) {
    return <div className="p-4 text-center text-slate-500">Loading drift alerts...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-slate-800/30 p-4 rounded-xl border border-slate-700/50">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Diagnostics Drift Alerts</h2>
          <p className="text-sm text-slate-400">Alerts generated when UI capabilities drift significantly from the baseline.</p>
        </div>
        <button onClick={loadAlerts} disabled={loading} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded border border-slate-700 transition-colors">
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
          {error}
        </div>
      )}

      <div className="bg-slate-800/20 border border-slate-800 rounded-xl overflow-hidden">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No open drift alerts.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 text-sm">
                  <th className="p-4 font-medium border-b border-slate-800">Date</th>
                  <th className="p-4 font-medium border-b border-slate-800">Provider</th>
                  <th className="p-4 font-medium border-b border-slate-800">Severity</th>
                  <th className="p-4 font-medium border-b border-slate-800">Summary</th>
                  <th className="p-4 font-medium border-b border-slate-800 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {alerts.map(alert => (
                  <tr key={alert.id} className="transition-colors hover:bg-slate-800/30">
                    <td className="p-4 text-sm text-slate-300">
                      {new Date(alert.createdAt).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm">
                      <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-xs uppercase tracking-wider">{alert.provider}</span>
                    </td>
                    <td className="p-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        alert.severity === "error" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                        alert.severity === "warning" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                        "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      }`}>
                        {alert.severity} (Score: {alert.driftScore})
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-300 max-w-xs truncate" title={alert.summary}>
                      {alert.summary}
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button onClick={() => handleResolve(alert.id, "accepted_change", alert.diagnosticsRunId)} className="px-2 py-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs rounded transition-colors">
                        Accept as New Baseline
                      </button>
                      <button onClick={() => handleResolve(alert.id, "ignored")} className="px-2 py-1 bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs rounded transition-colors">
                        Ignore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
