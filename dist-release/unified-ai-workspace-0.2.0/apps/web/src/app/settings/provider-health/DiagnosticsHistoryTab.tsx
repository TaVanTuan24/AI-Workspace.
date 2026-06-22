import { useEffect, useState } from "react";
import { listProviderDiagnosticsRuns, getProviderDiagnosticsRunDetail, listProviderDiagnosticsBaselines, setProviderDiagnosticsBaseline, evaluateProviderDiagnosticsDrift } from "../../../lib/api";
import { DiagnosticsDiffDrawer } from "./DiagnosticsDiffDrawer";
import { DiagnosticsDriftAlertsPanel } from "./DiagnosticsDriftAlertsPanel";

export function DiagnosticsHistoryTab() {
  const [runs, setRuns] = useState<any[]>([]);
  const [baselines, setBaselines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareToRunId, setCompareToRunId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [resRuns, resBaselines] = await Promise.all([
        listProviderDiagnosticsRuns({ limit: 100 }),
        listProviderDiagnosticsBaselines({ isActive: true, limit: 100 })
      ]);
      setRuns(resRuns.data || []);
      setBaselines(resBaselines.data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load diagnostics history");
    } finally {
      setLoading(false);
    }
  }

  function handleDiffClick(runId: string) {
    if (!selectedRunId) {
      setSelectedRunId(runId);
    } else if (selectedRunId === runId) {
      setSelectedRunId(null);
    } else {
      setCompareToRunId(runId);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-800/30 p-4 rounded-xl border border-slate-700/50">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Diagnostics Runs</h2>
          <p className="text-sm text-slate-400">View and compare UI diagnostic results to detect UI drift over time. No raw DOM or PII is recorded.</p>
        </div>
        <button onClick={loadData} disabled={loading} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded border border-slate-700 transition-colors">
          Refresh
        </button>
      </div>

      <DiagnosticsDriftAlertsPanel />

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
          {error}
        </div>
      )}

      <div className="bg-slate-800/20 border border-slate-800 rounded-xl overflow-hidden">
        {loading && runs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Loading history...</div>
        ) : runs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No diagnostic runs recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 text-sm">
                  <th className="p-4 font-medium border-b border-slate-800">Date</th>
                  <th className="p-4 font-medium border-b border-slate-800">Provider</th>
                  <th className="p-4 font-medium border-b border-slate-800">Status</th>
                  <th className="p-4 font-medium border-b border-slate-800">Findings</th>
                  <th className="p-4 font-medium border-b border-slate-800">Redactions</th>
                  <th className="p-4 font-medium border-b border-slate-800 text-right">Compare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {runs.map(run => {
                  const isSelected = selectedRunId === run.id;
                  const isBaseline = baselines.some(b => b.sourceRunId === run.id && b.isActive);
                  
                  return (
                    <tr key={run.id} className={`transition-colors hover:bg-slate-800/30 ${isSelected ? 'bg-indigo-500/10' : ''}`}>
                      <td className="p-4 text-sm text-slate-300">
                        <div className="flex items-center gap-2">
                          {new Date(run.startedAt).toLocaleString()}
                          {isBaseline && <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] uppercase rounded">Baseline</span>}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-1">{run.id.split("-")[0]}</div>
                      </td>
                      <td className="p-4 text-sm">
                        <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-xs uppercase tracking-wider">{run.provider}</span>
                      </td>
                      <td className="p-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          run.status === "ok" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          run.status === "ui_changed" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                          "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-300">
                        <div><span className="text-emerald-400">{run.detectedCapabilityCount}</span> detected</div>
                        {run.missingCapabilityCount > 0 && <div className="text-red-400 mt-1">{run.missingCapabilityCount} missing</div>}
                      </td>
                      <td className="p-4 text-sm text-slate-400">
                        {run.redactionCount > 0 ? (
                          <span className="text-amber-400/80">{run.redactionCount} fields redacted</span>
                        ) : "0"}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        {!isBaseline && (
                          <button
                            onClick={async () => {
                              try {
                                await setProviderDiagnosticsBaseline(run.id, `Manual baseline set for ${run.provider}`);
                                loadData();
                              } catch (err: any) { alert(err.message); }
                            }}
                            className="px-3 py-1.5 text-xs font-medium rounded transition-colors bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
                          >
                            Set Baseline
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            try {
                              const res = await evaluateProviderDiagnosticsDrift(run.id, false);
                              alert(`Drift Evaluation Score: ${res.data.driftScore}\nSeverity: ${res.data.severity}\nSummary: ${res.data.summary}`);
                            } catch (err: any) { alert(err.message); }
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded transition-colors bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
                        >
                          Eval Drift
                        </button>
                        <button
                          onClick={() => handleDiffClick(run.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                            isSelected ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                          }`}
                        >
                          {isSelected ? "Select Target" : selectedRunId ? "Compare to " + run.id.split("-")[0] : "Select for Diff"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRunId && compareToRunId && (
        <DiagnosticsDiffDrawer 
          leftRunId={selectedRunId} 
          rightRunId={compareToRunId}
          onClose={() => {
            setSelectedRunId(null);
            setCompareToRunId(null);
          }}
        />
      )}
    </div>
  );
}
